package br.com.construlog.motorista;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class ApiClient {
    private ApiClient() {}

    static JSONObject request(String path, String method, String token, JSONObject body) throws Exception {
        URL url = new URL(BuildConfig.API_BASE_URL + path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        conn.setRequestMethod(method);
        conn.setRequestProperty("Accept", "application/json");
        conn.setRequestProperty("User-Agent", "ConstrulogMotorista/1.0");
        if (token != null && !token.isEmpty()) {
            conn.setRequestProperty("Authorization", "Bearer " + token);
        }
        if (body != null) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            conn.getOutputStream().write(bytes);
        }

        int status = conn.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? conn.getInputStream() : conn.getErrorStream();
        StringBuilder sb = new StringBuilder();
        if (stream != null) {
            try (BufferedReader br = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
            }
        }
        JSONObject json;
        try {
            json = sb.length() > 0 ? new JSONObject(sb.toString()) : new JSONObject();
        } catch (Exception e) {
            json = new JSONObject();
        }
        if (status < 200 || status >= 300 || !json.optBoolean("ok", false)) {
            throw new Exception(json.optString("error", "Falha de comunicação com o servidor."));
        }
        return json;
    }

    static JSONObject enroll(String code, String deviceName) throws Exception {
        JSONObject b = new JSONObject();
        b.put("code", code);
        b.put("device_name", deviceName);
        return request("/api/tracking/enroll", "POST", null, b);
    }

    static JSONObject startSession(String token) throws Exception {
        return request("/api/tracking/session/start", "POST", token, new JSONObject());
    }

    static void sendPoint(String token, String sessionId, double lat, double lon,
                          float accuracy, float speed, float bearing, float battery) throws Exception {
        JSONObject b = new JSONObject();
        b.put("session_id", sessionId);
        b.put("latitude", lat);
        b.put("longitude", lon);
        if (!Float.isNaN(accuracy)) b.put("accuracy_m", accuracy);
        if (!Float.isNaN(speed)) b.put("speed_mps", speed);
        if (!Float.isNaN(bearing)) b.put("bearing_deg", bearing);
        if (!Float.isNaN(battery)) b.put("battery_pct", battery);
        b.put("captured_at", java.time.Instant.now().toString());
        request("/api/tracking/point", "POST", token, b);
    }

    static void stopSession(String token, String sessionId) throws Exception {
        JSONObject b = new JSONObject();
        if (sessionId != null) b.put("session_id", sessionId);
        request("/api/tracking/session/stop", "POST", token, b);
    }
}
