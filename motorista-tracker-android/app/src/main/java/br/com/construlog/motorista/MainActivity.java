package br.com.construlog.motorista;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
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
    private boolean pendingStart = false;
    private final android.os.Handler uiHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable uiRefresh = new Runnable() {
        @Override public void run() {
            refreshUi();
            uiHandler.postDelayed(this, 2000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        setContentView(buildUi());
        refreshUi();
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

        TextView hint = text(
                "Para melhor funcionamento, mantenha o GPS ligado. O Android pode exibir avisos de uso de localização em segundo plano.",
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

    private String timeLabel(long when) {
        if (when <= 0) return "—";
        return new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(new java.util.Date(when));
    }

    private void refreshUi() {
        String token = prefs.getString("token", "");
        boolean enrolled = !token.isEmpty();
        code.setVisibility(enrolled ? View.GONE : View.VISIBLE);
        activate.setVisibility(enrolled ? View.GONE : View.VISIBLE);
        start.setVisibility(enrolled ? View.VISIBLE : View.GONE);
        stop.setVisibility(enrolled ? View.VISIBLE : View.GONE);

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
}
