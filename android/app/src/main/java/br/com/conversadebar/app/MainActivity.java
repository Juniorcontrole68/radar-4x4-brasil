package br.com.conversadebar.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.media.AudioManager;
import android.media.AudioDeviceInfo;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.util.Arrays;

/** Android development shell. Payments and background audio are not implemented. */
public class MainActivity extends Activity {
    private static final String HOST = "conversa-de-bar.junior-controle68.workers.dev";
    private static final String APP_URL = "https://" + HOST + "/comercial/";
    private static final int MIC_REQUEST = 42;
    private WebView web;
    private PermissionRequest pendingMic;
    private AudioManager audioManager;
    private boolean audioActive;
    private int previousAudioMode;
    private boolean previousSpeakerphone;
    private AudioManager.OnCommunicationDeviceChangedListener routeListener;

    private void selectSpeaker() {
        if (!audioActive || audioManager == null || audioManager.getMode() == AudioManager.MODE_IN_CALL) return;
        if (Build.VERSION.SDK_INT >= 31) {
            for (AudioDeviceInfo device : audioManager.getAvailableCommunicationDevices()) {
                if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                    if (!audioManager.setCommunicationDevice(device))
                        Toast.makeText(this, "Não foi possível ativar o alto-falante. Confira a saída de áudio.", Toast.LENGTH_SHORT).show();
                    return;
                }
            }
            Toast.makeText(this, "Alto-falante indisponível neste aparelho.", Toast.LENGTH_SHORT).show();
        } else {
            audioManager.setSpeakerphoneOn(true);
        }
    }

    private void startSpeakerAudio() {
        if (audioActive || audioManager == null || audioManager.getMode() == AudioManager.MODE_IN_CALL) return;
        previousAudioMode = audioManager.getMode();
        previousSpeakerphone = audioManager.isSpeakerphoneOn();
        audioActive = true;
        audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
        if (Build.VERSION.SDK_INT >= 31) {
            routeListener = device -> {
                if (audioActive && (device == null || device.getType() != AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)) selectSpeaker();
            };
            audioManager.addOnCommunicationDeviceChangedListener(getMainExecutor(), routeListener);
        }
        selectSpeaker();
    }

    private void stopSpeakerAudio() {
        if (!audioActive || audioManager == null) return;
        audioActive = false;
        if (Build.VERSION.SDK_INT >= 31) {
            if (routeListener != null) audioManager.removeOnCommunicationDeviceChangedListener(routeListener);
            routeListener = null;
            audioManager.clearCommunicationDevice();
        } else {
            audioManager.setSpeakerphoneOn(previousSpeakerphone);
        }
        if (audioManager.getMode() == AudioManager.MODE_IN_COMMUNICATION) audioManager.setMode(previousAudioMode);
    }

    private boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        audioManager = getSystemService(AudioManager.class);
        web = new WebView(this);
        web.setBackgroundColor(0xff17110d);
        setContentView(web);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (trusted(uri)) return false;
                if ("https".equals(uri.getScheme()) && request.isForMainFrame()) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                // Only the trusted app document may request this restricted audio action.
                if (web.getUrl() != null && message.sourceId() != null && trusted(Uri.parse(web.getUrl())) && trusted(Uri.parse(message.sourceId()))) {
                    if ("CDB_AUDIO_START".equals(message.message())) {
                        runOnUiThread(() -> startSpeakerAudio()); return true;
                    }
                    if ("CDB_AUDIO_STOP".equals(message.message())) {
                        runOnUiThread(() -> stopSpeakerAudio()); return true;
                    }
                }
                return super.onConsoleMessage(message);
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!trusted(request.getOrigin()) || !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                        request.deny(); return;
                    }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else if (pendingMic == null) {
                        pendingMic = request;
                        requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, MIC_REQUEST);
                    } else request.deny();
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingMic == request) pendingMic = null;
            }
        });
        web.loadUrl(APP_URL);
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != MIC_REQUEST || pendingMic == null) return;
        PermissionRequest request = pendingMic;
        pendingMic = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED && trusted(request.getOrigin())) {
            request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            request.deny();
            Toast.makeText(this, "Permita o microfone para conversar por áudio.", Toast.LENGTH_LONG).show();
        }
    }

    @Override protected void onStop() {
        // Release microphone/session when leaving this foreground-only prototype.
        web.evaluateJavascript("if(typeof stopConversation==='function')stopConversation();", null);
        stopSpeakerAudio();
        super.onStop();
    }
    @Override protected void onDestroy() {
        if (pendingMic != null) { pendingMic.deny(); pendingMic = null; }
        stopSpeakerAudio();
        web.destroy();
        super.onDestroy();
    }
}
