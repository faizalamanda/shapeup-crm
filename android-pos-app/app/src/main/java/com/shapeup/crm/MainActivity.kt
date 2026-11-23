package com.shapeup.crm

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
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
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

class MainActivity : AppCompatActivity() {

    companion object {
        // Sama persis dengan start_url di manifest.json PWA (/onboarding)
        const val DEFAULT_SERVER_URL = "https://shapeup-crm.vercel.app/onboarding"
        private const val PREFS_NAME = "shapeup_pos_prefs"
        private const val KEY_SERVER_URL = "server_url"
        private const val REQUEST_BT_PERMS = 101
        private const val REQUEST_FILE_CHOOSER = 102
    }

    private lateinit var webView: WebView
    private lateinit var prefs: SharedPreferences
    private var volumeDownCount = 0
    private var lastVolumeDownTime = 0L
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

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
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            userAgentString = "$userAgentString ShapeUpNativeApp/1.2"
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                val scheme = (uri.scheme ?: "").lowercase()

                // 1. Handle Android intent:// scheme to open Chrome or external apps
                if (scheme == "intent") {
                    try {
                        val intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                        if (intent != null) {
                            startActivity(intent)
                            return true
                        }
                    } catch (_: Exception) {}
                    return true
                }

                // 2. Handle external schemes (WhatsApp, tel, mailto, Google Chrome direct scheme)
                if (scheme != "http" && scheme != "https" && scheme != "blob" && scheme != "data") {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, uri)
                        startActivity(intent)
                    } catch (_: Exception) {}
                    return true
                }

                // 3. Handle wa.me / api.whatsapp.com links natively in WhatsApp app
                val host = (uri.host ?: "").lowercase()
                if (host == "wa.me" || host == "api.whatsapp.com") {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, uri)
                        startActivity(intent)
                        return true
                    } catch (_: Exception) {}
                }

                return false // Biarkan WebView menangani seluruh navigasi internal ShapeUp CRM
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                CookieManager.getInstance().flush()
            }
        }

        // Dukungan Upload File (<input type="file"> untuk Import Produk, Import Order, Bukti Pengeluaran, Logo Struk)
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback

                return try {
                    val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                    }
                    startActivityForResult(Intent.createChooser(intent, "Pilih Berkas"), REQUEST_FILE_CHOOSER)
                    true
                } catch (e: Exception) {
                    this@MainActivity.filePathCallback = null
                    Toast.makeText(this@MainActivity, "Gagal membuka pemilih berkas", Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }

        // Dukungan Download File Standar HTTP/HTTPS via Android DownloadManager
        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            try {
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
                    val request = DownloadManager.Request(Uri.parse(url)).apply {
                        setMimeType(mimeType)
                        val cookies = CookieManager.getInstance().getCookie(url)
                        if (!cookies.isNullOrEmpty()) {
                            addRequestHeader("cookie", cookies)
                        }
                        addRequestHeader("User-Agent", userAgent)
                        setDescription("Mengunduh laporan ShapeUp CRM...")
                        setTitle(fileName)
                        setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                    }
                    val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                    dm.enqueue(request)
                    Toast.makeText(this, "📥 Mengunduh $fileName ke folder Downloads...", Toast.LENGTH_LONG).show()
                } else {
                    Toast.makeText(this, "Gunakan tombol Export untuk menyimpan berkas.", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                // Fallback: buka URL unduhan di browser eksternal (Chrome) jika DownloadManager terkendala izin
                openUrlInExternalBrowser(url)
            }
        }

        // SUNTIKKAN JEMBATAN BLUETOOTH & FILE NATIVE KE SELURUH JAVASCRIPT WEBSITE
        webView.addJavascriptInterface(PrinterBridge(this), "AndroidPrinter")
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQUEST_FILE_CHOOSER) {
            val callback = filePathCallback
            filePathCallback = null
            if (callback != null) {
                val results: Array<Uri>? = if (resultCode == Activity.RESULT_OK && data != null) {
                    val clipData = data.clipData
                    if (clipData != null && clipData.itemCount > 0) {
                        Array(clipData.itemCount) { i -> clipData.getItemAt(i).uri }
                    } else {
                        data.data?.let { arrayOf(it) }
                    }
                } else {
                    null
                }
                callback.onReceiveValue(results)
            }
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    /**
     * Menyimpan file Base64 (Excel .xlsx / CSV .csv) langsung ke folder Downloads Android
     * menggunakan MediaStore.Downloads (Android 10+) atau Environment.DIRECTORY_DOWNLOADS,
     * serta menampilkan dialog pilihan Buka File / Bagikan.
     */
    fun saveBase64ToDownloads(base64Data: String, fileName: String, mimeType: String) {
        runOnUiThread {
            try {
                val cleanBase64 = if (base64Data.contains(",")) {
                    base64Data.substringAfter(",")
                } else {
                    base64Data
                }
                val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                val resolvedMime = mimeType.ifBlank {
                    if (fileName.endsWith(".csv", true)) "text/csv"
                    else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                }

                // 1. Simpan ke folder Downloads publik
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val resolver = contentResolver
                    val contentValues = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                        put(MediaStore.Downloads.MIME_TYPE, resolvedMime)
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                        put(MediaStore.Downloads.IS_PENDING, 1)
                    }
                    val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    val itemUri = resolver.insert(collection, contentValues)
                    if (itemUri != null) {
                        resolver.openOutputStream(itemUri)?.use { out ->
                            out.write(bytes)
                            out.flush()
                        }
                        contentValues.clear()
                        contentValues.put(MediaStore.Downloads.IS_PENDING, 0)
                        resolver.update(itemUri, contentValues, null, null)
                    }
                } else {
                    val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    if (!downloadsDir.exists()) downloadsDir.mkdirs()
                    val destFile = File(downloadsDir, fileName)
                    FileOutputStream(destFile).use { out ->
                        out.write(bytes)
                        out.flush()
                    }
                }

                // 2. Simpan juga salinan di cache/exports agar bisa langsung dibuka / di-share via FileProvider
                val exportDir = File(cacheDir, "exports")
                if (!exportDir.exists()) exportDir.mkdirs()
                val cacheFile = File(exportDir, fileName)
                FileOutputStream(cacheFile).use { out ->
                    out.write(bytes)
                    out.flush()
                }
                val shareUri = FileProvider.getUriForFile(this, "$packageName.fileprovider", cacheFile)

                Toast.makeText(this, "✅ Tersimpan di folder Downloads: $fileName", Toast.LENGTH_LONG).show()

                AlertDialog.Builder(this)
                    .setTitle("✅ Berkas Berhasil Diunduh")
                    .setMessage("Berkas \"$fileName\" telah disimpan di folder Downloads perangkat Anda.")
                    .setPositiveButton("📂 Buka Berkas") { _, _ ->
                        try {
                            val openIntent = Intent(Intent.ACTION_VIEW).apply {
                                setDataAndType(shareUri, resolvedMime)
                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            startActivity(Intent.createChooser(openIntent, "Buka dengan"))
                        } catch (_: Exception) {
                            Toast.makeText(this, "Tidak ada aplikasi pembuka Excel/CSV di perangkat ini.", Toast.LENGTH_SHORT).show()
                        }
                    }
                    .setNeutralButton("📲 Bagikan (WA / Email)") { _, _ ->
                        shareFileUri(shareUri, fileName, resolvedMime)
                    }
                    .setNegativeButton("Tutup", null)
                    .show()

            } catch (e: Exception) {
                Toast.makeText(this, "Gagal menyimpan berkas: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    /**
     * Membuka Native Android Share Sheet (WhatsApp, Telegram, Email, Google Drive) untuk file Base64.
     */
    fun shareBase64FileNative(base64Data: String, fileName: String, mimeType: String) {
        runOnUiThread {
            try {
                val cleanBase64 = if (base64Data.contains(",")) {
                    base64Data.substringAfter(",")
                } else {
                    base64Data
                }
                val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                val resolvedMime = mimeType.ifBlank {
                    if (fileName.endsWith(".csv", true)) "text/csv"
                    else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                }

                val exportDir = File(cacheDir, "exports")
                if (!exportDir.exists()) exportDir.mkdirs()
                val cacheFile = File(exportDir, fileName)
                FileOutputStream(cacheFile).use { out ->
                    out.write(bytes)
                    out.flush()
                }

                val shareUri = FileProvider.getUriForFile(this, "$packageName.fileprovider", cacheFile)
                shareFileUri(shareUri, fileName, resolvedMime)
            } catch (e: Exception) {
                Toast.makeText(this, "Gagal membagikan berkas: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun shareFileUri(uri: Uri, fileName: String, mimeType: String) {
        try {
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, fileName)
                putExtra(Intent.EXTRA_TEXT, "Laporan ShapeUp CRM: $fileName")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(shareIntent, "Bagikan $fileName ke..."))
        } catch (e: Exception) {
            Toast.makeText(this, "Gagal membuka menu bagikan: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * Membuka URL di browser Chrome / eksternal perangkat Android.
     */
    fun openUrlInExternalBrowser(url: String) {
        runOnUiThread {
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(intent)
            } catch (e: Exception) {
                Toast.makeText(this, "Gagal membuka browser: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
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
