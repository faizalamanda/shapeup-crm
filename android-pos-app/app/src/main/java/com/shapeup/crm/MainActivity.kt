package com.shapeup.crm

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    companion object {
        const val DEFAULT_SERVER_URL = "https://shapeup-crm.vercel.app"
        private const val PREFS_NAME = "shapeup_pos_prefs"
        private const val KEY_SERVER_URL = "server_url"
        private const val REQUEST_BT_PERMS = 101
    }

    private lateinit var webView: WebView
    private lateinit var prefs: SharedPreferences

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Jaga layar kasir tetap menyala (Anti-Sleep saat melayani antrean)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        // Setup Layout Utama dengan FrameLayout
        val rootLayout = FrameLayout(this)
        setContentView(rootLayout)

        // Setup WebView
        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }
        rootLayout.addView(webView)

        // Area Tombol Rahasia di Pojok Kiri Atas (Tekan Lama 3 Detik untuk Ubah URL)
        val secretArea = View(this).apply {
            layoutParams = FrameLayout.LayoutParams(120, 120, Gravity.TOP or Gravity.START)
            setBackgroundColor(0x00000000) // Transparan
            setOnLongClickListener {
                showServerUrlDialog()
                true
            }
        }
        rootLayout.addView(secretArea)

        configureWebView()
        requestBluetoothPermissions()

        // Muat URL tersimpan atau default
        loadServerUrl()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = userAgentString + " ShapeUpNativeApp/1.0"
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false // Biarkan WebView menangani seluruh navigasi internal
            }
        }

        webView.webChromeClient = WebChromeClient()

        // SUNTIKKAN JEMBATAN BLUETOOTH NATIVE KE SELURUH JAVASCRIPT WEBSITE
        webView.addJavascriptInterface(PrinterBridge(this), "AndroidPrinter")
    }

    private fun loadServerUrl() {
        val targetUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        webView.loadUrl(targetUrl)
    }

    /**
     * Dialog untuk mengganti alamat server kapan saja jika besok domain berganti
     */
    private fun showServerUrlDialog() {
        val currentUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        val input = EditText(this).apply {
            setText(currentUrl)
            setSelection(text.length)
            setPadding(50, 40, 50, 40)
        }

        AlertDialog.Builder(this)
            .setTitle("⚙️ Pengaturan Alamat Server")
            .setMessage("Ubah alamat web server ShapeUp jika domain berganti:")
            .setView(input)
            .setPositiveButton("Simpan & Muat Ulang") { _, _ ->
                val newUrl = input.text.toString().trim()
                if (newUrl.startsWith("http://") || newUrl.startsWith("https://")) {
                    prefs.edit().putString(KEY_SERVER_URL, newUrl).apply()
                    webView.loadUrl(newUrl)
                    Toast.makeText(this, "Alamat server diperbarui ke: $newUrl", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this, "URL harus diawali dengan http:// atau https://", Toast.LENGTH_LONG).show()
                }
            }
            .setNeutralButton("Reset ke Default") { _, _ ->
                prefs.edit().putString(KEY_SERVER_URL, DEFAULT_SERVER_URL).apply()
                webView.loadUrl(DEFAULT_SERVER_URL)
                Toast.makeText(this, "Kembali ke default: $DEFAULT_SERVER_URL", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    private fun requestBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val needed = mutableListOf<String>()
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_CONNECT)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_SCAN)
            }
            if (needed.isNotEmpty()) {
                ActivityCompat.requestPermissions(this, needed.toTypedArray(), REQUEST_BT_PERMS)
            }
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        try {
            webView.destroy()
        } catch (_: Exception) {}
        super.onDestroy()
    }
}

