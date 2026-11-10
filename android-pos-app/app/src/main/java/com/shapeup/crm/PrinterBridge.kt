package com.shapeup.crm

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.util.Base64
import android.webkit.JavascriptInterface
import java.io.OutputStream
import java.util.UUID

class PrinterBridge(private val context: Context) {
    // Standard Serial Port Profile (SPP) UUID untuk seluruh printer thermal Bluetooth
    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    private var activeSocket: BluetoothSocket? = null
    private var activeOutputStream: OutputStream? = null
    private var activeMacAddress: String? = null

    private fun getBluetoothAdapter(): BluetoothAdapter? {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return manager?.adapter ?: BluetoothAdapter.getDefaultAdapter()
    }

    /**
     * Mengambil daftar printer Bluetooth yang sudah pernah dipasangkan (Paired Devices)
     * di menu Pengaturan Bluetooth tablet/HP Android.
     */
    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun getPairedPrinters(): String {
        return try {
            val adapter = getBluetoothAdapter() ?: return "[]"
            val devices = adapter.bondedDevices ?: return "[]"
            val jsonList = devices.map { device ->
                val safeName = (device.name ?: "Unknown Device").replace("\"", "\\\"")
                val safeAddress = (device.address ?: "").replace("\"", "\\\"")
                "{\"name\":\"$safeName\",\"address\":\"$safeAddress\"}"
            }
            "[${jsonList.joinToString(",")}]"
        } catch (e: Exception) {
            "[]"
        }
    }

    /**
     * Memeriksa apakah socket printer sedang dalam kondisi terhubung
     */
    @JavascriptInterface
    fun isConnected(): Boolean {
        return activeSocket?.isConnected == true
    }

    /**
     * Mengirim data cetak raw ESC/POS dalam format Base64 secara native.
     * Menggunakan socket RFCOMM Bluetooth Classic yang sangat stabil dan anti-sleep.
     */
    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun print(base64Data: String, targetMacAddress: String): String {
        return try {
            if (base64Data.isBlank()) {
                return "ERROR: Data cetak kosong"
            }

            val rawBytes = Base64.decode(base64Data, Base64.DEFAULT)
            val adapter = getBluetoothAdapter() ?: return "ERROR: Bluetooth tidak tersedia di perangkat ini"

            if (!adapter.isEnabled) {
                return "ERROR: Bluetooth sedang nonaktif. Silakan aktifkan Bluetooth tablet."
            }

            // Tentukan target MAC Address: jika kosong, cari otomatis printer yang ter-pair
            var mac = targetMacAddress.trim()
            if (mac.isBlank()) {
                val bonded = adapter.bondedDevices
                if (bonded.isNullOrEmpty()) {
                    return "ERROR: Belum ada printer Bluetooth yang dipasangkan di tablet ini."
                }
                // Prioritaskan device yang namanya mengandung printer/pos/thermal
                val matched = bonded.find { d ->
                    val n = (d.name ?: "").lowercase()
                    n.contains("print") || n.contains("pos") || n.contains("rpp") || n.contains("mpt") || n.contains("thermal")
                } ?: bonded.first()
                mac = matched.address
            }

            // Gunakan socket aktif jika masih terhubung ke MAC yang sama
            if (activeSocket == null || !activeSocket!!.isConnected || activeMacAddress != mac) {
                closeConnection()

                val device: BluetoothDevice = adapter.getRemoteDevice(mac)
                adapter.cancelDiscovery()

                // Buat socket RFCOMM SPP
                val socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
                socket.connect()

                activeSocket = socket
                activeOutputStream = socket.outputStream
                activeMacAddress = mac
            }

            // Kirim byte cetak langsung ke hardware printer
            activeOutputStream?.write(rawBytes)
            activeOutputStream?.flush()

            "SUCCESS"
        } catch (e: Exception) {
            closeConnection()
            "ERROR: " + (e.message ?: "Gagal mencetak ke printer")
        }
    }

    @JavascriptInterface
    fun disconnect() {
        closeConnection()
    }

    private fun closeConnection() {
        try {
            activeOutputStream?.close()
        } catch (_: Exception) {}
        try {
            activeSocket?.close()
        } catch (_: Exception) {}
        activeOutputStream = null
        activeSocket = null
        activeMacAddress = null
    }
}

