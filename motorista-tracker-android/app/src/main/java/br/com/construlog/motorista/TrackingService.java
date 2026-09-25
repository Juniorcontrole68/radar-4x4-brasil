package br.com.construlog.motorista;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class TrackingService extends Service implements LocationListener {
    static final String ACTION_START = "br.com.construlog.motorista.START";
    static final String ACTION_STOP = "br.com.construlog.motorista.STOP";
    private static final String CHANNEL_ID = "tracking";
    private static final int NOTIFICATION_ID = 301;

    private LocationManager locationManager;
    private SharedPreferences prefs;
    private ExecutorService executor;
    private Handler main;
    private volatile boolean locationStarted = false;
    private volatile long lastSentAt = 0L;

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE);
        executor = Executors.newSingleThreadExecutor();
        main = new Handler(Looper.getMainLooper());
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        startForeground(NOTIFICATION_ID, buildNotification("Preparando rastreamento…"));

        if (ACTION_STOP.equals(action)) {
            stopRoute();
            return START_NOT_STICKY;
        }

        String token = prefs.getString("token", "");
        if (token.isEmpty()) {
            prefs.edit().putString("tracking_state","Celular não ativado").apply();
            updateNotification("Celular não ativado");
            stopSelf();
            return START_NOT_STICKY;
        }

        String sessionId = prefs.getString("session_id", "");
        if (!sessionId.isEmpty()) {
            beginLocation();
        } else if (ACTION_START.equals(action)) {
            createSession();
        } else {
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    private void createSession() {
        updateNotification("Iniciando rota…");
        prefs.edit().putString("tracking_state","Criando sessão no servidor…").remove("last_error").apply();
        String token = prefs.getString("token", "");
        executor.submit(() -> {
            try {
                JSONObject j = ApiClient.startSession(token);
                String session = j.getString("session_id");
                prefs.edit().putString("session_id", session).putString("tracking_state","Sessão criada • iniciando GPS").remove("last_error").apply();
                main.post(this::beginLocation);
            } catch (Exception e) {
                prefs.edit().putString("tracking_state","Falha ao criar sessão").putString("last_error",String.valueOf(e.getMessage())).apply();
                main.post(() -> {
                    updateNotification("Falha ao iniciar rota");
                    stopForeground(STOP_FOREGROUND_REMOVE);
                    stopSelf();
                });
            }
        });
    }

    private void beginLocation() {
        if (locationStarted) return;
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
                checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            prefs.edit().putString("tracking_state","Permissão de localização ausente").putString("last_error","Permita a localização para o aplicativo.").apply();
            updateNotification("Permissão de localização ausente");
            stopSelf();
            return;
        }
        try {
            long gpsTime = BuildConfig.TEST_MODE ? 5000L : 30000L;
            float gpsDistance = BuildConfig.TEST_MODE ? 0f : 30f;
            long netTime = BuildConfig.TEST_MODE ? 7000L : 45000L;
            float netDistance = BuildConfig.TEST_MODE ? 0f : 75f;
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, gpsTime, gpsDistance, this);
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, netTime, netDistance, this);
            }
            locationStarted = true;
            prefs.edit().putString("tracking_state","Rastreamento ativo • aguardando primeira posição GPS").remove("last_error").apply();
            updateNotification("Rastreamento ativo • aguardando GPS");
            Location last = null;
            try { last = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER); } catch (Exception ignored) {}
            if (last == null) {
                try { last = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER); } catch (Exception ignored) {}
            }
            if (last != null) onLocationChanged(last);
        } catch (SecurityException e) {
            updateNotification("Permissão de localização ausente");
            stopSelf();
        } catch (Exception e) {
            prefs.edit().putString("tracking_state","GPS indisponível").putString("last_error",String.valueOf(e.getMessage())).apply();
            updateNotification("GPS indisponível");
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location == null) return;
        long now = System.currentTimeMillis();
        long minSend = BuildConfig.TEST_MODE ? 5000L : 20000L;
        if (now - lastSentAt < minSend) return;
        lastSentAt = now;

        String token = prefs.getString("token", "");
        String session = prefs.getString("session_id", "");
        if (token.isEmpty() || session.isEmpty()) return;

        double lat = location.getLatitude();
        double lon = location.getLongitude();
        float accuracy = location.hasAccuracy() ? location.getAccuracy() : Float.NaN;
        float speed = location.hasSpeed() ? location.getSpeed() : Float.NaN;
        float bearing = location.hasBearing() ? location.getBearing() : Float.NaN;
        float battery = batteryPercent();
        prefs.edit()
                .putString("last_gps", String.format(java.util.Locale.US, "%.6f, %.6f", lat, lon))
                .putLong("last_gps_at", System.currentTimeMillis())
                .putString("tracking_state","GPS recebido • enviando ao servidor")
                .apply();

        updateNotification("Rastreamento ativo • GPS atualizado");
        executor.submit(() -> {
            try {
                ApiClient.sendPoint(token, session, lat, lon, accuracy, speed, bearing, battery);
                prefs.edit()
                        .putLong("last_send_at", System.currentTimeMillis())
                        .putString("tracking_state","Posição enviada ao servidor com sucesso")
                        .remove("last_error")
                        .apply();
                main.post(() -> updateNotification("Rastreamento ativo • posição enviada"));
            } catch (Exception e) {
                prefs.edit()
                        .putString("tracking_state","GPS obtido • falha ao enviar")
                        .putString("last_error",String.valueOf(e.getMessage()))
                        .apply();
                main.post(() -> updateNotification("Rastreamento ativo • aguardando conexão"));
            }
        });
    }

    private float batteryPercent() {
        try {
            BatteryManager bm = (BatteryManager) getSystemService(BATTERY_SERVICE);
            int p = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            return p >= 0 ? p : Float.NaN;
        } catch (Exception e) {
            return Float.NaN;
        }
    }

    private void stopRoute() {
        try {
            if (locationManager != null) locationManager.removeUpdates(this);
        } catch (Exception ignored) {}
        locationStarted = false;

        String token = prefs.getString("token", "");
        String session = prefs.getString("session_id", "");
        updateNotification("Encerrando rota…");

        executor.submit(() -> {
            try {
                if (!token.isEmpty() && !session.isEmpty()) ApiClient.stopSession(token, session);
            } catch (Exception ignored) {
            } finally {
                prefs.edit().remove("session_id").apply();
                main.post(() -> {
                    stopForeground(STOP_FOREGROUND_REMOVE);
                    stopSelf();
                });
            }
        });
    }

    private void createChannel() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Rastreamento de rota",
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Mostra quando a rota e o GPS do motorista estão ativos.");
        nm.createNotificationChannel(channel);
    }

    private Notification buildNotification(String message) {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent content = PendingIntent.getActivity(
                this, 10, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stop = new Intent(this, TrackingService.class);
        stop.setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(
                this, 11, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String driver = prefs.getString("driver_name", "Motorista");
        return new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_location)
                .setContentTitle("CONSTRULOG • " + driver)
                .setContentText(message)
                .setContentIntent(content)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .addAction(new Notification.Action.Builder(
                        R.drawable.ic_location, "Encerrar rota", stopPi).build())
                .build();
    }

    private void updateNotification(String message) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(NOTIFICATION_ID, buildNotification(message));
    }

    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override
    public void onProviderEnabled(String provider) {}

    @Override
    public void onProviderDisabled(String provider) {
        updateNotification("Rastreamento ativo • GPS desativado");
    }

    @Override
    public void onDestroy() {
        try {
            if (locationManager != null) locationManager.removeUpdates(this);
        } catch (Exception ignored) {}
        if (executor != null) executor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
