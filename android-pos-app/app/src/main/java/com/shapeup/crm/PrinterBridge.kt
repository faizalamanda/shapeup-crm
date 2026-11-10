package com.shapeup.crm

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.webkit.JavascriptInterface
import androidx.core.content.ContextCompat
import java.io.OutputStream
import java.util.UUID

class PrinterBridge(private val activity: MainActivity) {
    // Standard Serial Port Profile (SPP) UUID untuk seluruh printer thermal Bluetooth
    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    private var activeSocket: BluetoothSocket? = null
    private var activeOutputStream: OutputStream? = null
    private var activeMacAddress: String? = null

    private fun getBluetoothAdapter(): BluetoothAdapter? {
        val manager = activity.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return manager?.adapter ?: BluetoothAdapter.getDefaultAdapter()
    }

    private fun ensureBluetoothPermission(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val hasConnect = ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.BLUETOOTH_CONNECT
            ) == PackageManager.PERMISSION_GRANTED
            if (!hasConnect) {
                activity.runOnUiThread {
                    activity.requestBluetoothPermissions()
                }
                return false
            }
        }
        return true
    }

    /**
     * Mengambil daftar printer Bluetooth yang sudah pernah dipasangkan (Paired Devices)
     * di menu Pengaturan Bluetooth tablet/HP Android.
     */
    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun getPairedPrinters(): String {
        return try {
            if (!ensureBluetoothPermission()) {
                return "[]"
            }
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
     * Membuka menu Pengaturan Bluetooth bawaan HP/Tablet Android
     */
    @JavascriptInterface
    fun openBluetoothSettings() {
        try {
            val intent = Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
        } catch (_: Exception) {}
    }

    /**
     * Membuka dialog ubah alamat server
     */
    @JavascriptInterface
    fun openServerSettings() {
        activity.runOnUiThread {
            activity.showServerUrlDialog()
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
            if (!ensureBluetoothPermission()) {
                return "ERROR: Izin Bluetooth belum diberikan. Silakan izinkan akses perangkat di sekitar pada pop-up yang muncul lalu coba lagi."
            }
            if (base64Data.isBlank()) {
                return "ERROR: Data cetak kosong"
            }

            val rawBytes = Base64.decode(base64Data, Base64.DEFAULT)
            val adapter = getBluetoothAdapter() ?: return "ERROR: Bluetooth tidak tersedia di perangkat ini"

            if (!adapter.isEnabled) {
                return "ERROR: Bluetooth HP/Tablet sedang nonaktif. Silakan aktifkan Bluetooth terlebih dahulu."
            }

            // Tentukan target MAC Address: bisa dikirim berupa MAC Address ("66:22:...") ATAU Nama Printer ("MPT-II")
            val query = targetMacAddress.trim()
            val bonded = adapter.bondedDevices
            if (bonded.isNullOrEmpty()) {
                return "ERROR: Belum ada printer Bluetooth yang dipasangkan di HP/Tablet ini."
            }

            var mac = ""
            if (query.isNotEmpty()) {
                val exactMatch = bonded.find { d ->
                    d.address.equals(query, ignoreCase = true) ||
                    (d.name != null && d.name.equals(query, ignoreCase = true))
                }
                if (exactMatch != null) {
                    mac = exactMatch.address
                } else if (BluetoothAdapter.checkBluetoothAddress(query.uppercase())) {
                    mac = query.uppercase()
                }
            }

            if (mac.isBlank()) {
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

            // Kirim byte cetak ke hardware printer secara bertahap (Chunked Flow Control)
            // guna mencegah RX Buffer Overflow (4KB limit) pada printer thermal 58mm saat mencetak struk panjang/logo
            val out = activeOutputStream ?: return "ERROR: Output stream printer tidak tersedia"
            val chunkSize = 512
            var offset = 0
            while (offset < rawBytes.size) {
                val length = minOf(chunkSize, rawBytes.size - offset)
                out.write(rawBytes, offset, length)
                out.flush()
                offset += length
                if (offset < rawBytes.size) {
                    Thread.sleep(35)
                }
            }

            "SUCCESS"
        } catch (e: Exception) {
            closeConnection()
            "ERROR: " + (e.message ?: "Gagal mencetak ke printer. Pastikan printer menyala.")
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
