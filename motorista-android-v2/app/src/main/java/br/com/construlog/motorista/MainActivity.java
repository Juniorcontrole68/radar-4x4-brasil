package br.com.construlog.motorista;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import org.json.JSONObject;
import java.util.concurrent.*;

public class MainActivity extends Activity {
    private LinearLayout root;
    private TextView status;
    private EditText driver,plate;
    private Button activate;
    private final ScheduledExecutorService exec=Executors.newSingleThreadScheduledExecutor();

    @Override public void onCreate(Bundle b){
        super.onCreate(b);
        buildUi();
        driver.setText(Prefs.driver(this));
        plate.setText(Prefs.plate(this));
        ensurePermissions();
        if(!Prefs.token(this).isEmpty()){
            status.setText("Aparelho aprovado. Preparando rastreamento automático…");
            startTracker();
            activate.setText("Rastreamento configurado");
            activate.setEnabled(false);
        }else if(!Prefs.requestToken(this).isEmpty()){
            status.setText("Aguardando liberação do aparelho…");
            pollApproval(Prefs.requestToken(this));
        }
    }

    private void buildUi(){
        ScrollView scroll=new ScrollView(this);
        root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(38,48,38,38);
        TextView title=new TextView(this);title.setText("CONSTRULOG Motorista");title.setTextSize(25);title.setTextColor(Color.rgb(15,23,42));title.setTypeface(null,1);
        TextView sub=new TextView(this);sub.setText("Rastreamento automático por romaneio");sub.setTextSize(15);sub.setPadding(0,8,0,30);
        driver=input("Nome do motorista");plate=input("Placa do veículo");
        activate=new Button(this);activate.setText("ATIVAR RASTREAMENTO");activate.setOnClickListener(v->register());
        status=new TextView(this);status.setText("Informe nome e placa. Depois da primeira aprovação, o rastreamento será automático.");status.setTextSize(15);status.setPadding(0,24,0,20);
        TextView help=new TextView(this);help.setText("Para funcionar com a tela apagada: Localização = Permitir o tempo todo • Localização precisa = ligada • Bateria = Sem restrições • Dados em segundo plano = permitidos.");help.setTextSize(13);
        Button settings=new Button(this);settings.setText("ABRIR CONFIGURAÇÕES DO APP");settings.setOnClickListener(v->{
            Intent i=new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+getPackageName()));startActivity(i);
        });
        root.addView(title);root.addView(sub);root.addView(driver);root.addView(plate);root.addView(activate);root.addView(status);root.addView(help);root.addView(settings);
        scroll.addView(root);setContentView(scroll);
    }

    private EditText input(String hint){
        EditText e=new EditText(this);e.setHint(hint);e.setSingleLine(true);e.setTextSize(18);e.setPadding(0,18,0,18);return e;
    }

    private void ensurePermissions(){
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},100);
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},101);
            return;
        }
        if(Build.VERSION.SDK_INT>=29 && checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)!=PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION},102);
    }

    private void register(){
        String d=driver.getText().toString().trim();
        String p=plate.getText().toString().trim().toUpperCase().replaceAll("[^A-Z0-9]","");
        if(d.length()<2){status.setText("Informe o nome do motorista.");return;}
        if(p.length()<7){status.setText("Informe uma placa válida.");return;}
        Prefs.saveIdentity(this,d,p);
        activate.setEnabled(false);status.setText("Registrando aparelho…");
        exec.execute(()->{
            try{
                JSONObject body=new JSONObject();
                body.put("driver_name",d);body.put("vehicle_plate",p);body.put("device_name",Api.deviceName());
                JSONObject j=Api.request("POST","/api/tracking/register-request",body,null);
                String rq=j.optString("request_token","");
                if(!rq.isEmpty())Prefs.saveRequest(this,rq);
                String token=j.optString("token","");
                if("approved".equals(j.optString("status"))&&!token.isEmpty()){
                    Prefs.saveToken(this,token,j.optString("driver_name",d),j.optString("vehicle_plate",p));
                    runOnUiThread(()->approved());
                }else{
                    runOnUiThread(()->{status.setText("Solicitação enviada. Aguardando aprovação da central…");activate.setEnabled(true);});
                    if(!rq.isEmpty())pollApproval(rq);
                }
            }catch(Exception e){runOnUiThread(()->{status.setText("Falha ao registrar: "+e.getMessage());activate.setEnabled(true);});}
        });
    }

    private void pollApproval(String rq){
        exec.scheduleAtFixedRate(()->{
            if(!Prefs.token(this).isEmpty())return;
            try{
                JSONObject j=Api.request("GET","/api/tracking/register-status?request_token="+java.net.URLEncoder.encode(rq,"UTF-8"),null,null);
                if("approved".equals(j.optString("status"))&&!j.optString("token").isEmpty()){
                    Prefs.saveToken(this,j.optString("token"),j.optString("driver_name",Prefs.driver(this)),j.optString("vehicle_plate",Prefs.plate(this)));
                    runOnUiThread(this::approved);
                }else runOnUiThread(()->status.setText("Aparelho aguardando aprovação…"));
            }catch(Exception ignored){}
        },2,8,TimeUnit.SECONDS);
    }

    private void approved(){
        status.setText("Aparelho aprovado. Rastreamento automático ativado.");
        activate.setText("RASTREAMENTO ATIVO");activate.setEnabled(false);
        ensurePermissions();startTracker();
    }

    private void startTracker(){
        Intent i=new Intent(this,TrackingService.class);
        if(Build.VERSION.SDK_INT>=26)startForegroundService(i);else startService(i);
    }

    @Override protected void onResume(){
        super.onResume();
        if(!Prefs.token(this).isEmpty())startTracker();
    }

    @Override protected void onDestroy(){
        super.onDestroy();
    }
}
