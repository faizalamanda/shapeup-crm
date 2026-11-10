package com.shapeup.crm

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    companion object {
        // Sama persis dengan start_url di manifest.json PWA (/onboarding)
        const val DEFAULT_SERVER_URL = "https://shapeup-crm.vercel.app/onboarding"
        private const val PREFS_NAME = "shapeup_pos_prefs"
        private const val KEY_SERVER_URL = "server_url"
        private const val REQUEST_BT_PERMS = 101
    }

    private lateinit var webView: WebView
    private lateinit var prefs: SharedPreferences
    private var volumeDownCount = 0
    private var lastVolumeDownTime = 0L

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Jaga layar kasir tetap menyala (Anti-Sleep saat melayani antrean)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        // Gunakan WebView langsung sebagai contentView (TANPA overlay apapun agar semua menu 100% mudah diklik!)
        webView = WebView(this)
        setContentView(webView)

        configureWebView()
        requestBluetoothPermissions()

        // Muat URL tersimpan atau default (/onboarding)
        loadServerUrl()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        // Aktifkan Hardware Acceleration & Fokus Sentuhan Penuh
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true

        // Pastikan Cookie & Session Login tersimpan permanen seperti di PWA Chrome
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = true
            javaScriptCanOpenWindowsAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            userAgentString = "$userAgentString ShapeUpNativeApp/1.1"
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false // Biarkan WebView menangani seluruh navigasi internal
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                CookieManager.getInstance().flush()
            }
        }

        webView.webChromeClient = WebChromeClient()

        // SUNTIKKAN JEMBATAN BLUETOOTH NATIVE KE SELURUH JAVASCRIPT WEBSITE
        webView.addJavascriptInterface(PrinterBridge(this), "AndroidPrinter")
    }

    private fun loadServerUrl() {
        var targetUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        // Migrasi otomatis jika sebelumnya tersimpan root domain tanpa /onboarding
        if (targetUrl == "https://shapeup-crm.vercel.app" || targetUrl == "https://shapeup-crm.vercel.app/") {
            targetUrl = DEFAULT_SERVER_URL
            prefs.edit().putString(KEY_SERVER_URL, targetUrl).apply()
        }
        webView.loadUrl(targetUrl)
    }

    /**
     * Dialog untuk mengganti alamat server kapan saja jika besok domain berganti.
     * Dapat dibuka dengan menekan tombol fisik Volume Bawah 3x cepat.
     */
    fun showServerUrlDialog() {
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

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Tekan tombol Volume Bawah 3x berturut-turut untuk membuka pengaturan URL Server
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            val now = System.currentTimeMillis()
            if (now - lastVolumeDownTime < 800) {
                volumeDownCount++
            } else {
                volumeDownCount = 1
            }
            lastVolumeDownTime = now
            if (volumeDownCount >= 3) {
                volumeDownCount = 0
                showServerUrlDialog()
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    fun requestBluetoothPermissions() {
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
            CookieManager.getInstance().flush()
            webView.destroy()
        } catch (_: Exception) {}
        super.onDestroy()
    }
}
