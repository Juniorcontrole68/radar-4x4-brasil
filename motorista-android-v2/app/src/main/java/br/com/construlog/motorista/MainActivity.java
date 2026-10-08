package br.com.construlog.motorista;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Tela única do motorista: mostra em uma frase se está tudo certo e, quando não está,
 * lista só o que falta, cada item com um botão que resolve.
 */
public class MainActivity extends Activity {
    private static final int RQ_NOTIF=100, RQ_LOCATION=101, RQ_BACKGROUND=102;
    private TextView big,sub,foot;
    private LinearLayout steps,form;
    private EditText driver,plate;
    private Button activate,update,route;
    private final Handler ui=new Handler(Looper.getMainLooper());
    private final ScheduledExecutorService exec=Executors.newSingleThreadScheduledExecutor();
    private volatile boolean polling=false,registering=false,resumed=false;
    private boolean guiding=false;
    private String stepsKey="?";
    private final Runnable refresher=new Runnable(){@Override public void run(){if(!resumed)return;refresh();ui.postDelayed(this,2000);}};

    private static final class Step{
        final String id,text,button;final Runnable action;
        Step(String id,String text,String button,Runnable action){this.id=id;this.text=text;this.button=button;this.action=action;}
    }

    @Override public void onCreate(Bundle b){
        super.onCreate(b);
        Notifier.channels(this);
        buildUi();
        driver.setText(Prefs.driver(this));
        plate.setText(Prefs.plate(this));
        testHooks(getIntent());
    }

    @Override protected void onNewIntent(Intent intent){
        super.onNewIntent(intent);
        testHooks(intent);
    }

    @Override protected void onResume(){
        super.onResume();
        resumed=true;
        Watchdog.schedule(this);
        if(!Prefs.token(this).isEmpty())TrackingService.start(this,"aberto");
        else if(!Prefs.requestToken(this).isEmpty())pollApproval();
        ui.removeCallbacks(refresher);
        refresher.run();
        // Primeira abertura: pede as permissões em sequência, sem o motorista procurar botão.
        if(!Prefs.guided(this)){
            Prefs.setGuided(this);
            guiding=true;
            ui.postDelayed(this::guideNext,700);
        }
    }

    @Override protected void onPause(){
        resumed=false;
        ui.removeCallbacks(refresher);
        super.onPause();
    }

    @Override protected void onDestroy(){
        exec.shutdownNow();
        super.onDestroy();
    }

    // ---------------------------------------------------------------- tela

    private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}

    private TextView text(String s,int sp,int color,boolean bold){
        TextView t=new TextView(this);t.setText(s);t.setTextSize(sp);t.setTextColor(color);
        if(bold)t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button button(String s,int bg){
        Button b=new Button(this);b.setText(s);b.setAllCaps(false);b.setTextSize(16);b.setTextColor(Color.WHITE);b.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable d=new GradientDrawable();d.setColor(bg);d.setCornerRadius(dp(12));
        b.setBackground(d);b.setPadding(dp(14),dp(14),dp(14),dp(14));
        return b;
    }

    private LinearLayout.LayoutParams block(int top){
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0,dp(top),0,0);
        return lp;
    }

    private EditText input(String hint){
        EditText e=new EditText(this);e.setHint(hint);e.setSingleLine(true);e.setTextSize(18);
        e.setPadding(dp(4),dp(14),dp(4),dp(14));
        return e;
    }

    private void buildUi(){
        ScrollView scroll=new ScrollView(this);
        scroll.setFitsSystemWindows(true);
        scroll.setBackgroundColor(Color.rgb(245,247,250));
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20),dp(28),dp(20),dp(28));

        root.addView(text("CONSTRULOG Motorista",24,Color.rgb(0,87,168),true));
        root.addView(text("Rastreamento automático por romaneio",14,Color.rgb(100,116,139),false));

        LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable cd=new GradientDrawable();cd.setColor(Color.WHITE);cd.setCornerRadius(dp(16));
        card.setBackground(cd);card.setPadding(dp(18),dp(18),dp(18),dp(18));
        big=text("",22,Color.rgb(15,23,42),true);
        sub=text("",15,Color.rgb(71,85,105),false);sub.setPadding(0,dp(6),0,0);
        card.addView(big);card.addView(sub);
        root.addView(card,block(18));

        form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);
        driver=input("Seu nome completo");
        driver.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        plate=input("Placa do veículo");
        plate.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        activate=button("ATIVAR RASTREAMENTO",Color.rgb(242,140,0));
        activate.setOnClickListener(v->register());
        form.addView(driver);form.addView(plate);form.addView(activate,block(10));
        root.addView(form,block(14));

        steps=new LinearLayout(this);steps.setOrientation(LinearLayout.VERTICAL);
        root.addView(steps,block(6));

        route=button("🗺️  ABRIR ROTA DE HOJE",Color.rgb(22,20,47));
        route.setOnClickListener(v->openTodayRoute());
        route.setVisibility(View.GONE);
        root.addView(route,block(14));

        update=button("ATUALIZAR APLICATIVO",Color.rgb(0,87,168));
        update.setOnClickListener(v->openUrl(Notifier.updateUrl()));
        update.setVisibility(View.GONE);
        root.addView(update,block(14));

        foot=text("",12,Color.rgb(100,116,139),false);
        foot.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(foot,block(22));

        TextView settings=text("Abrir configurações do aplicativo",13,Color.rgb(0,87,168),false);
        settings.setGravity(Gravity.CENTER_HORIZONTAL);settings.setPadding(0,dp(14),0,dp(14));
        settings.setOnClickListener(v->openAppSettings());
        root.addView(settings,block(4));

        scroll.addView(root);
        setContentView(scroll);
    }

    private List<Step> missing(){
        List<Step> out=new ArrayList<>();
        if(!Health.permLocation(this))
            out.add(new Step("loc","Permita que o aplicativo use a localização do celular.","PERMITIR LOCALIZAÇÃO",this::askLocation));
        else if(!Health.permBackground(this))
            out.add(new Step("bg","Na tela que vai abrir, escolha \"Permitir o tempo todo\". Sem isso o rastreio para quando a tela apaga.","PERMITIR O TEMPO TODO",this::askBackground));
        if(!Health.permNotifications(this))
            out.add(new Step("notif","Permita as notificações. É o aviso fixo que mantém o rastreio ligado.","PERMITIR NOTIFICAÇÕES",this::askNotifications));
        if(!Health.batteryUnrestricted(this))
            out.add(new Step("bat","Libere o aplicativo para funcionar com a tela apagada (toque em \"Permitir\").","LIBERAR COM A TELA APAGADA",this::askBattery));
        if(!Health.gpsOn(this))
            out.add(new Step("gps","A Localização (GPS) do celular está desligada.","LIGAR A LOCALIZAÇÃO",this::askGps));
        return out;
    }

    private void refresh(){
        boolean hasToken=!Prefs.token(this).isEmpty();
        boolean waiting=!hasToken&&!Prefs.requestToken(this).isEmpty();
        boolean lost=hasToken&&Prefs.authLost(this);
        List<Step> todo=missing();

        boolean showForm=(!hasToken&&!waiting)||lost;
        form.setVisibility(showForm?View.VISIBLE:View.GONE);
        if(showForm&&!registering){
            activate.setEnabled(true);
            activate.setText(lost?"REATIVAR ESTE CELULAR":"ATIVAR RASTREAMENTO");
        }

        if(lost){
            big.setText("Este celular precisa ser reativado");big.setTextColor(Color.rgb(185,28,28));
            sub.setText("A central deixou de reconhecer este aparelho. Confira nome e placa e toque em REATIVAR.");
        }else if(!hasToken&&!waiting){
            big.setText("Ative o rastreamento");big.setTextColor(Color.rgb(15,23,42));
            if(!registering)sub.setText("Informe seu nome e a placa. É só na primeira vez.");
        }else if(waiting){
            big.setText("Aguardando a central liberar");big.setTextColor(Color.rgb(180,83,9));
            sub.setText(todo.isEmpty()
                ?"Pedido enviado. Pode fechar o aplicativo: quando a central liberar, o rastreio começa sozinho."
                :"Pedido enviado. Enquanto isso, resolva o que falta abaixo.");
        }else if(!todo.isEmpty()){
            big.setText(todo.size()==1?"Falta 1 passo":"Faltam "+todo.size()+" passos");big.setTextColor(Color.rgb(180,83,9));
            sub.setText("Toque no botão de cada item abaixo. Leva menos de um minuto.");
        }else{
            big.setText("✅ Tudo certo");big.setTextColor(Color.rgb(21,128,61));
            String st=TrackingService.statusText;
            sub.setText("Pode fechar esta tela. O rastreio funciona sozinho, não precisa abrir o aplicativo todo dia."+(st.isEmpty()?"":"\n\nAgora: "+st));
        }

        StringBuilder key=new StringBuilder();
        for(Step s:todo)key.append(s.id).append(',');
        if(!key.toString().equals(stepsKey)){
            stepsKey=key.toString();
            steps.removeAllViews();
            for(final Step s:todo){
                LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);
                GradientDrawable d=new GradientDrawable();d.setColor(Color.rgb(255,247,237));d.setCornerRadius(dp(14));d.setStroke(dp(1),Color.rgb(253,186,116));
                box.setBackground(d);box.setPadding(dp(14),dp(14),dp(14),dp(14));
                box.addView(text(s.text,15,Color.rgb(124,45,18),false));
                Button b=button(s.button,Color.rgb(234,88,12));
                b.setOnClickListener(v->{guiding=false;s.action.run();});
                box.addView(b,block(10));
                steps.addView(box,block(10));
            }
        }

        route.setVisibility(hasToken&&!lost?View.VISIBLE:View.GONE);
        boolean newer=Prefs.latestCode(this)>BuildConfig.VERSION_CODE;
        update.setVisibility(newer?View.VISIBLE:View.GONE);
        String who=Prefs.driver(this),pl=Prefs.plate(this);
        foot.setText((who.isEmpty()?"":who+(pl.isEmpty()?"":" • "+pl)+"\n")+"Versão "+BuildConfig.VERSION_NAME);
    }

    // ---------------------------------------------------------------- permissões

    /** Na primeira abertura, encadeia os pedidos: localização → o tempo todo → notificações → bateria. */
    private void guideNext(){
        if(!guiding||!resumed)return;
        if(!Health.permLocation(this)){askLocation();return;}
        if(!Health.permBackground(this)){askBackground();return;}
        if(!Health.permNotifications(this)&&Build.VERSION.SDK_INT>=33){askNotifications();return;}
        guiding=false;
        if(!Health.batteryUnrestricted(this))askBattery();
    }

    private void askLocation(){
        requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},RQ_LOCATION);
    }
    private void askBackground(){
        if(Build.VERSION.SDK_INT>=29)requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION},RQ_BACKGROUND);
    }
    private void askNotifications(){
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},RQ_NOTIF);
            return;
        }
        try{
            startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()));
        }catch(Exception e){openAppSettings();}
    }
    private void askBattery(){
        try{
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,Uri.parse("package:"+getPackageName())));
        }catch(Exception e){
            try{startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));}
            catch(Exception e2){openAppSettings();}
        }
    }
    private void askGps(){
        try{startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));}
        catch(Exception e){openAppSettings();}
    }
    private void openAppSettings(){
        try{startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));}
        catch(Exception ignored){}
    }
    private void openUrl(String url){
        try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));}
        catch(Exception e){Toast.makeText(this,"Não foi possível abrir o navegador.",Toast.LENGTH_LONG).show();}
    }

    @Override public void onRequestPermissionsResult(int code,String[] perms,int[] results){
        super.onRequestPermissionsResult(code,perms,results);
        boolean granted=results.length>0;
        for(int r:results)if(r!=PackageManager.PERMISSION_GRANTED)granted=false;
        if(code==RQ_LOCATION)granted=Health.permLocation(this);
        if(!granted&&perms.length>0&&!guiding){
            // Negado em definitivo: o Android não mostra mais a pergunta, então abre as configurações.
            boolean canAsk=false;
            for(String p:perms)if(shouldShowRequestPermissionRationale(p))canAsk=true;
            if(!canAsk){
                Toast.makeText(this,code==RQ_NOTIF?"Ative as notificações do aplicativo.":"Toque em Permissões → Localização → Permitir o tempo todo.",Toast.LENGTH_LONG).show();
                openAppSettings();
            }
        }
        if(Health.permLocation(this)&&!Prefs.token(this).isEmpty())TrackingService.start(this,"permissao");
        refresh();
        if(guiding){
            if(granted)ui.postDelayed(this::guideNext,400);
            else guiding=false;
        }
    }

    // ---------------------------------------------------------------- rota do dia (aplicativo MOVIT)

    /** Abre o MOVIT já identificado como este motorista, com as entregas do romaneio de hoje. */
    private void openTodayRoute(){
        route.setEnabled(false);route.setText("ABRINDO A ROTA…");
        exec.execute(()->{
            String appUrl="",download="";String error="";
            try{
                JSONObject j=Api.request("POST","/api/tracking/movit-link",new JSONObject(),Prefs.token(this));
                appUrl=j.optString("app_url","");download=j.optString("download_url","");
            }catch(Exception e){error=e.getMessage()==null?"sem conexão":e.getMessage();}
            final String fa=appUrl,fd=download,fe=error;
            ui.post(()->{
                route.setEnabled(true);route.setText("🗺️  ABRIR ROTA DE HOJE");
                if(fa.isEmpty()){Toast.makeText(this,"Não foi possível abrir a rota: "+fe,Toast.LENGTH_LONG).show();return;}
                try{
                    startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(fa)));
                }catch(Exception notInstalled){
                    Toast.makeText(this,"Instale o aplicativo MOVIT para ver a rota. Depois toque de novo neste botão.",Toast.LENGTH_LONG).show();
                    if(!fd.isEmpty())openUrl(fd);
                }
            });
        });
    }

    // ---------------------------------------------------------------- ativação

    private void register(){
        final String d=driver.getText().toString().trim().replaceAll("\\s+"," ");
        final String p=plate.getText().toString().trim().toUpperCase().replaceAll("[^A-Z0-9]","");
        if(d.length()<2){sub.setText("Informe o seu nome.");return;}
        if(p.length()<7){sub.setText("Informe a placa completa do veículo (7 caracteres).");return;}
        Prefs.saveIdentity(this,d,p);
        registering=true;
        activate.setEnabled(false);activate.setText("ENVIANDO…");
        sub.setText("Enviando o pedido para a central…");
        exec.execute(()->{
            try{
                JSONObject body=new JSONObject();
                body.put("driver_name",d);body.put("vehicle_plate",p);body.put("device_name",Api.deviceName());
                JSONObject j=Api.request("POST","/api/tracking/register-request",body,null);
                String rq=j.optString("request_token","");
                String token=j.optString("token","");
                if("approved".equals(j.optString("status"))&&!token.isEmpty()){
                    Prefs.saveToken(this,token,j.optString("driver_name",d),j.optString("vehicle_plate",p));
                    ui.post(()->{registering=false;onApproved();});
                }else{
                    // Novo pedido: a credencial antiga (se havia) deixa de valer neste aparelho.
                    if(!rq.isEmpty()){
                        if(!Prefs.token(this).isEmpty())Prefs.saveToken(this,"",d,p);
                        Prefs.saveRequest(this,rq);
                    }
                    ui.post(()->{registering=false;Watchdog.schedule(this);refresh();pollApproval();});
                }
            }catch(Exception e){
                final String msg=e.getMessage()==null?"sem conexão":e.getMessage();
                ui.post(()->{registering=false;activate.setEnabled(true);refresh();sub.setText("Não foi possível enviar: "+msg+". Confira a internet e tente de novo.");});
            }
        });
    }

    private void pollApproval(){
        if(polling)return;
        polling=true;
        exec.scheduleWithFixedDelay(()->{
            try{
                if(!Prefs.token(this).isEmpty()||Prefs.requestToken(this).isEmpty())return;
                if(!resumed)return;   // com a tela fechada, quem busca a liberação é o vigia
                if(Backend.pollApproval(this))ui.post(this::onApproved);
            }catch(Throwable ignored){}
        },2,8,TimeUnit.SECONDS);
    }

    private void onApproved(){
        Watchdog.schedule(this);
        TrackingService.start(this,"liberado");
        refresh();
    }

    // ---------------------------------------------------------------- apoio ao teste automático

    private void testHooks(Intent intent){
        if(!BuildConfig.TEST_HOOKS||intent==null)return;
        String d=intent.getStringExtra("auto_driver"),p=intent.getStringExtra("auto_plate");
        if(d==null||p==null)return;
        if(!Prefs.token(this).isEmpty()||!Prefs.requestToken(this).isEmpty())return;   // só no primeiro uso
        driver.setText(d);plate.setText(p);
        ui.postDelayed(this::register,500);
    }
}
