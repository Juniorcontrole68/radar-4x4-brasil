package br.com.construlog.motorista;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    static final String PREFS = "tracking";
    private static final int REQ_PERMS = 100;
    private SharedPreferences prefs;
    private TextView status;
    private TextView identity;
    private TextView diagnostics;
    private EditText code;
    private Button activate;
    private Button start;
    private Button stop;
    private Button preciseLocation;
    private Button gpsSettings;
    private Button batterySettings;
    private TextView androidSettingsStatus;
    private TextView updateStatus;
    private Button updateButton;
    private JSONObject pendingUpdate;
    private long updateDownloadId = -1L;
    private boolean receiverRegistered = false;
    private boolean pendingStart = false;
    private final android.os.Handler uiHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable uiRefresh = new Runnable() {
        @Override public void run() {
            refreshUi();
            uiHandler.postDelayed(this, 2000);
        }
    };

    private final BroadcastReceiver updateReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
            if (id != updateDownloadId) return;
            installDownloadedUpdate(id);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        setContentView(buildUi());
        registerUpdateReceiver();
        refreshUi();
        checkForUpdate(false);
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(22), dp(24), dp(22), dp(28));
        scroll.addView(root);

        TextView logo = text("CONSTRULOG", 14, true);
        logo.setTextColor(Color.rgb(15, 118, 110));
        root.addView(logo);

        TextView title = text(BuildConfig.TEST_MODE ? "Motorista TESTE" : "Motorista", 28, true);
        title.setPadding(0, dp(4), 0, dp(4));
        root.addView(title);

        if (BuildConfig.TEST_MODE) {
            TextView testBadge = text("VERSÃO DE TESTE • pode ficar instalada junto com a versão normal", 13, true);
            testBadge.setTextColor(Color.rgb(180, 83, 9));
            testBadge.setPadding(0, 0, 0, dp(12));
            root.addView(testBadge);
        }

        TextView versionInfo = text("Versão " + BuildConfig.VERSION_NAME, 12, false);
        versionInfo.setTextColor(Color.GRAY);
        root.addView(versionInfo);

        updateStatus = text("Verificando atualizações…", 13, false);
        updateStatus.setTextColor(Color.DKGRAY);
        updateStatus.setPadding(0, dp(6), 0, 0);
        root.addView(updateStatus);

        updateButton = button("Verificar atualização");
        updateButton.setOnClickListener(v -> {
            if (pendingUpdate != null && pendingUpdate.optBoolean("available", false)) startUpdateDownload();
            else checkForUpdate(true);
        });
        root.addView(updateButton, buttonLayout());

        TextView privacy = text(
                "O rastreamento só funciona enquanto você mantiver uma rota ativa. " +
                "Durante esse período, sua localização é enviada à central e uma notificação permanente fica visível no celular.",
                14, false);
        privacy.setTextColor(Color.DKGRAY);
        privacy.setPadding(0, 0, 0, dp(18));
        root.addView(privacy);

        identity = text("", 17, true);
        identity.setPadding(0, dp(8), 0, dp(14));
        root.addView(identity);

        code = new EditText(this);
        code.setHint("Código de ativação (6 dígitos)");
        code.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        code.setTextSize(18);
        root.addView(code, fullWidth());

        activate = button("Ativar este celular");
        activate.setOnClickListener(v -> activateDevice());
        root.addView(activate, buttonLayout());

        start = button("▶ Iniciar rota");
        start.setOnClickListener(v -> requestAndStart());
        root.addView(start, buttonLayout());

        stop = button("■ Encerrar rota");
        stop.setOnClickListener(v -> stopTracking());
        root.addView(stop, buttonLayout());

        status = text("Aguardando ativação.", 15, true);
        status.setPadding(0, dp(18), 0, 0);
        root.addView(status);

        diagnostics = text("", 13, false);
        diagnostics.setTextColor(Color.DKGRAY);
        diagnostics.setPadding(0, dp(12), 0, 0);
        root.addView(diagnostics);

        TextView androidTitle = text("Configuração do Android", 17, true);
        androidTitle.setPadding(0, dp(20), 0, dp(4));
        root.addView(androidTitle);

        androidSettingsStatus = text("", 13, false);
        androidSettingsStatus.setTextColor(Color.DKGRAY);
        root.addView(androidSettingsStatus);

        preciseLocation = button("Ativar localização precisa");
        preciseLocation.setOnClickListener(v -> openAppSettings());
        root.addView(preciseLocation, buttonLayout());

        gpsSettings = button("Ativar GPS do aparelho");
        gpsSettings.setOnClickListener(v -> openLocationSettings());
        root.addView(gpsSettings, buttonLayout());

        batterySettings = button("Liberar bateria para rastreamento");
        batterySettings.setOnClickListener(v -> requestBatteryExemption());
        root.addView(batterySettings, buttonLayout());

        TextView hint = text(
                "O Android exige sua confirmação para localização precisa e bateria sem restrição. O CONSTRULOG não altera essas permissões silenciosamente.",
                12, false);
        hint.setTextColor(Color.GRAY);
        hint.setPadding(0, dp(20), 0, 0);
        root.addView(hint);

        return scroll;
    }

    private LinearLayout.LayoutParams fullWidth() {
        return new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams buttonLayout() {
        LinearLayout.LayoutParams p = fullWidth();
        p.topMargin = dp(10);
        return p;
    }

    private Button button(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(16);
        b.setAllCaps(false);
        b.setMinHeight(dp(52));
        return b;
    }

    private TextView text(String s, int size, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        if (bold) t.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return t;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void registerUpdateReceiver() {
        if (receiverRegistered) return;
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(updateReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(updateReceiver, filter);
        receiverRegistered = true;
    }

    private void checkForUpdate(boolean manual) {
        if (updateButton == null || updateStatus == null) return;
        updateButton.setEnabled(false);
        if (manual) updateStatus.setText("Verificando atualização…");
        new Thread(() -> {
            try {
                JSONObject j = ApiClient.checkUpdate();
                runOnUiThread(() -> {
                    pendingUpdate = j;
                    boolean available = j.optBoolean("available", false);
                    if (available) {
                        String v = j.optString("latestVersionName", "");
                        updateStatus.setText("Nova versão disponível: " + (v.isEmpty() ? "atualização" : v));
                        updateStatus.setTextColor(Color.rgb(180, 83, 9));
                        updateButton.setText("Atualizar agora");
                    } else {
                        updateStatus.setText("Aplicativo atualizado • versão " + BuildConfig.VERSION_NAME);
                        updateStatus.setTextColor(Color.rgb(22, 101, 52));
                        updateButton.setText("Verificar atualização");
                    }
                    updateButton.setEnabled(true);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (manual) updateStatus.setText("Não foi possível verificar agora. Tente novamente.");
                    else updateStatus.setText("Versão " + BuildConfig.VERSION_NAME + " • verificação automática indisponível");
                    updateStatus.setTextColor(Color.GRAY);
                    updateButton.setText("Verificar atualização");
                    updateButton.setEnabled(true);
                });
            }
        }).start();
    }

    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getPackageManager().canRequestPackageInstalls();
    }

    private void openInstallPermission() {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            i.setData(Uri.parse("package:" + getPackageName()));
            startActivity(i);
        } catch (Exception e) {
            openAppSettings();
        }
    }

    private void startUpdateDownload() {
        if (pendingUpdate == null || !pendingUpdate.optBoolean("available", false)) {
            checkForUpdate(true);
            return;
        }
        if (!canInstallPackages()) {
            updateStatus.setText("Autorize 'Instalar apps desconhecidos' para o CONSTRULOG e volte para continuar.");
            updateStatus.setTextColor(Color.rgb(180, 83, 9));
            openInstallPermission();
            return;
        }
        String url = pendingUpdate.optString("apkUrl", "");
        if (url.isEmpty()) {
            updateStatus.setText("Link da atualização indisponível.");
            return;
        }
        try {
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            String fileName = BuildConfig.TEST_MODE
                    ? "CONSTRULOG-Motorista-TESTE-atualizacao.apk"
                    : "CONSTRULOG-Motorista-NORMAL-atualizacao.apk";
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Atualização CONSTRULOG Motorista");
            request.setDescription("Baixando nova versão…");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName);
            updateDownloadId = dm.enqueue(request);
            updateStatus.setText("Baixando atualização…");
            updateButton.setEnabled(false);
        } catch (Exception e) {
            updateStatus.setText("Falha ao iniciar download: " + e.getMessage());
            updateButton.setEnabled(true);
        }
    }

    private void installDownloadedUpdate(long id) {
        try {
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            Uri uri = dm.getUriForDownloadedFile(id);
            if (uri == null) {
                updateStatus.setText("Download não concluído. Toque em atualizar novamente.");
                updateButton.setEnabled(true);
                return;
            }
            updateStatus.setText("Download concluído. Confirme a instalação no Android.");
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(install);
        } catch (Exception e) {
            updateStatus.setText("Não foi possível abrir a instalação: " + e.getMessage());
            updateButton.setEnabled(true);
        }
    }

    private String timeLabel(long when) {
        if (when <= 0) return "—";
        return new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(new java.util.Date(when));
    }

    private boolean hasPreciseLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean isGpsEnabled() {
        try {
            LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
            return lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        } catch (Exception e) {
            return false;
        }
    }

    private boolean isBatteryUnrestricted() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    private void openAppSettings() {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            i.setData(Uri.parse("package:" + getPackageName()));
            startActivity(i);
        } catch (Exception e) {
            status.setText("Abra Configurações > Aplicativos > CONSTRULOG Motorista > Permissões.");
        }
    }

    private void openLocationSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
        } catch (Exception e) {
            status.setText("Abra as configurações de Localização do Android.");
        }
    }

    private void requestBatteryExemption() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        try {
            if (isBatteryUnrestricted()) {
                status.setText("Bateria já está liberada para o CONSTRULOG.");
                refreshUi();
                return;
            }
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + getPackageName()));
            startActivity(i);
        } catch (Exception e) {
            try {
                startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            } catch (Exception ignored) {
                openAppSettings();
            }
        }
    }

    private void refreshUi() {
        String token = prefs.getString("token", "");
        boolean enrolled = !token.isEmpty();
        code.setVisibility(enrolled ? View.GONE : View.VISIBLE);
        activate.setVisibility(enrolled ? View.GONE : View.VISIBLE);
        start.setVisibility(enrolled ? View.VISIBLE : View.GONE);
        stop.setVisibility(enrolled ? View.VISIBLE : View.GONE);

        boolean precise = hasPreciseLocation();
        boolean gpsOn = isGpsEnabled();
        boolean batteryOk = isBatteryUnrestricted();
        if (preciseLocation != null) preciseLocation.setVisibility(precise ? View.GONE : View.VISIBLE);
        if (gpsSettings != null) gpsSettings.setVisibility(gpsOn ? View.GONE : View.VISIBLE);
        if (batterySettings != null) batterySettings.setVisibility(batteryOk ? View.GONE : View.VISIBLE);
        if (androidSettingsStatus != null) {
            StringBuilder a = new StringBuilder();
            a.append("Localização precisa: ").append(precise ? "OK" : "AJUSTAR").append("\n");
            a.append("GPS do aparelho: ").append(gpsOn ? "LIGADO" : "DESLIGADO").append("\n");
            a.append("Bateria sem restrição: ").append(batteryOk ? "OK" : "AJUSTAR");
            androidSettingsStatus.setText(a.toString());
            androidSettingsStatus.setTextColor((precise && gpsOn && batteryOk) ? Color.rgb(22, 101, 52) : Color.rgb(180, 83, 9));
        }

        String session = prefs.getString("session_id", "");
        String state = prefs.getString("tracking_state", "");
        String lastGps = prefs.getString("last_gps", "");
        long lastGpsAt = prefs.getLong("last_gps_at", 0L);
        long lastSendAt = prefs.getLong("last_send_at", 0L);
        long lastHeartbeatAt = prefs.getLong("last_heartbeat_at", 0L);
        String lastError = prefs.getString("last_error", "");

        if (enrolled) {
            String driver = prefs.getString("driver_name", "");
            String plate = prefs.getString("vehicle_plate", "");
            identity.setText(driver + (plate.isEmpty() ? "" : " • " + plate));
            if (!state.isEmpty()) status.setText(state);
            else status.setText(session.isEmpty()
                    ? "Celular ativado. Toque em Iniciar rota."
                    : "Rota ativa. Aguardando atualização do GPS.");
        } else {
            identity.setText("Primeiro acesso");
            status.setText("Digite o código fornecido pela central.");
        }

        if (diagnostics != null) {
            StringBuilder d = new StringBuilder();
            d.append("DIAGNÓSTICO\n");
            d.append("Ativado: ").append(enrolled ? "SIM" : "NÃO").append("\n");
            d.append("Sessão: ").append(session.isEmpty() ? "NÃO INICIADA" : "ATIVA").append("\n");
            d.append("Último GPS: ").append(lastGps.isEmpty() ? "—" : lastGps).append(" • ").append(timeLabel(lastGpsAt)).append("\n");
            d.append("Último envio de posição: ").append(timeLabel(lastSendAt)).append("\n");
            d.append("Último sinal do app: ").append(timeLabel(lastHeartbeatAt));
            if (!lastError.isEmpty()) d.append("\nErro: ").append(lastError);
            diagnostics.setText(d.toString());
        }
    }

    private void activateDevice() {
        String activationCode = code.getText().toString().trim();
        if (!activationCode.matches("\\d{6}")) {
            status.setText("Informe o código de 6 dígitos.");
            return;
        }
        activate.setEnabled(false);
        status.setText("Ativando celular…");
        String deviceName = Build.MANUFACTURER + " " + Build.MODEL;

        new Thread(() -> {
            try {
                JSONObject j = ApiClient.enroll(activationCode, deviceName);
                prefs.edit()
                        .putString("token", j.getString("token"))
                        .putString("driver_name", j.optString("driver_name", "Motorista"))
                        .putString("vehicle_plate", j.optString("vehicle_plate", ""))
                        .putString("tracking_state", "Celular ativado • pronto para iniciar rota")
                        .remove("last_error")
                        .apply();
                runOnUiThread(() -> {
                    code.setText("");
                    status.setText("Celular ativado com sucesso.");
                    refreshUi();
                });
            } catch (Exception e) {
                runOnUiThread(() -> status.setText("Não foi possível ativar: " + e.getMessage()));
            } finally {
                runOnUiThread(() -> activate.setEnabled(true));
            }
        }).start();
    }

    private void requestAndStart() {
        if (!isGpsEnabled()) {
            status.setText("Ative o GPS do aparelho para iniciar a rota.");
            openLocationSettings();
            return;
        }
        List<String> missing = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.ACCESS_FINE_LOCATION);
            missing.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!missing.isEmpty()) {
            pendingStart = true;
            requestPermissions(missing.toArray(new String[0]), REQ_PERMS);
            return;
        }
        startTracking();
    }

    private void startTracking() {
        pendingStart = false;
        Intent i = new Intent(this, TrackingService.class);
        i.setAction(TrackingService.ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i);
        else startService(i);
        prefs.edit().putString("tracking_state","Comando enviado • iniciando rota e GPS…").remove("last_error").apply();
        status.setText("Iniciando rota e GPS…");
        getWindow().getDecorView().postDelayed(this::refreshUi, 800);
    }

    private void stopTracking() {
        Intent i = new Intent(this, TrackingService.class);
        i.setAction(TrackingService.ACTION_STOP);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i);
        else startService(i);
        status.setText("Encerrando rota…");
        getWindow().getDecorView().postDelayed(this::refreshUi, 1800);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_PERMS || !pendingStart) return;
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            startTracking();
        } else {
            pendingStart = false;
            status.setText("A localização é necessária para acompanhar a rota.");
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (prefs != null) refreshUi();
        uiHandler.removeCallbacks(uiRefresh);
        uiHandler.postDelayed(uiRefresh, 1200);
    }

    @Override
    protected void onPause() {
        uiHandler.removeCallbacks(uiRefresh);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        uiHandler.removeCallbacks(uiRefresh);
        if (receiverRegistered) {
            try { unregisterReceiver(updateReceiver); } catch (Exception ignored) {}
            receiverRegistered = false;
        }
        super.onDestroy();
    }
}
