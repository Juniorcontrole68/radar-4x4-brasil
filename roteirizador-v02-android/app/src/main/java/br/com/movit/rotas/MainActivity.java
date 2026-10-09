package br.com.movit.rotas;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.location.Location;
import android.location.LocationManager;
import android.location.LocationListener;
import android.net.Uri;
import android.os.*;
import android.speech.RecognizerIntent;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.net.URLEncoder;
import java.util.*;
import java.util.concurrent.*;

public class MainActivity extends Activity {
    private static final int REQ_VOICE=10,REQ_LOC=11,REQ_TEST_LOC=12,REQ_FUEL_LOC=13;
    private final ArrayList<JSONObject> stops=new ArrayList<>();
    private final ExecutorService exec=Executors.newSingleThreadExecutor();
    private LinearLayout list;
    private EditText address;
    private TextView status,summary;
    private WebView map;
    private JSONObject start=null,lastPlan=null;
    private android.content.SharedPreferences prefs;
    private TextView account,routeTitle,startPointLabel;
    private Button cloudSave,cloudRoutes,optimizeButton,testTrackingButton,truckRestrictionsButton,fuelButton,tollButton;
    private Switch returnStartHome;
    private LocationManager testLocationManager;
    private LocationListener testLocationListener;
    private String testTrackingToken="";
    private boolean testTrackingActive=false;
    private AlertDialog fuelDialog,tollDialog,restrictionDialog;
    private boolean fuelRequestRunning=false,tollRequestRunning=false,restrictionRequestRunning=false;
    // Dois modos no mesmo app: "dia" = entregas do romaneio enviadas pela empresa; "livre" = o
    // motorista monta a rota que quiser. Cada modo guarda as suas paradas separadamente.
    private static final String MODE_DAY="dia",MODE_FREE="livre";
    private String mode=MODE_FREE;
    private LinearLayout modeBar,searchRowView,startRowView,shareRowView;
    private LinearLayout.LayoutParams mapParams;
    private Button modeDayButton,modeFreeButton,refreshDayButton,startRouteButton,editStopsButton;
    private boolean dayLoading=false,dayReloadWanted=false;
    private int dayBuildingTries=0;
    private long dayLoadedAt=0L;

    @Override public void onCreate(Bundle b){
        super.onCreate(b);
        prefs=getSharedPreferences("rv2_account",MODE_PRIVATE);
        if(!prefs.contains("current_return_start"))prefs.edit().putBoolean("current_return_start",true).apply();
        mode=companyLinked()&&MODE_DAY.equals(prefs.getString("mode",MODE_FREE))?MODE_DAY:MODE_FREE;
        buildUi();loadState();applyMode();renderList();renderMap(lastPlan);refreshAccount();refreshStartPointUi();handleSharedRouteIntent(getIntent());
    }

    @Override protected void onResume(){
        super.onResume();
        // Rota do dia: ao voltar para o app, confere se há entregas novas ou baixadas.
        if(MODE_DAY.equals(mode)&&companyLinked()&&System.currentTimeMillis()-dayLoadedAt>120000L)loadDay(false);
    }

    // ---------------------------------------------------------------- modos e estado guardado

    private boolean companyLinked(){return !prefs.getString("company_token","").isEmpty();}
    private boolean dayMode(){return MODE_DAY.equals(mode);}

    /** Guarda as paradas do modo atual para não perder a rota quando o app é fechado. */
    private void persistState(){
        try{
            JSONObject st=new JSONObject();JSONArray arr=new JSONArray();
            for(JSONObject x:stops)arr.put(x);
            st.put("stops",arr);
            if(start!=null)st.put("start",start);
            st.put("returnToStart",prefs.getBoolean("current_return_start",false));
            st.put("name",prefs.getString("current_route_name","Nova rota"));
            if(lastPlan!=null&&dayMode()){   // o traçado da rota livre é refeito ao otimizar
                JSONObject pl=new JSONObject();
                if(lastPlan.optJSONObject("geometry")!=null)pl.put("geometry",lastPlan.optJSONObject("geometry"));
                pl.put("distanceMeters",lastPlan.optDouble("distanceMeters",0));
                pl.put("durationSeconds",lastPlan.optDouble("durationSeconds",0));
                if(pl.toString().length()<400000)st.put("plan",pl);
            }
            prefs.edit().putString("state_"+mode,st.toString()).apply();
        }catch(Exception ignored){}
    }

    private void loadState(){
        stops.clear();start=null;lastPlan=null;
        try{
            String raw=prefs.getString("state_"+mode,"");
            if(raw.isEmpty())return;
            JSONObject st=new JSONObject(raw);
            JSONArray arr=st.optJSONArray("stops");
            if(arr!=null)for(int i=0;i<arr.length();i++)stops.add(arr.getJSONObject(i));
            start=st.optJSONObject("start");
            lastPlan=dayMode()?st.optJSONObject("plan"):null;
            prefs.edit().putBoolean("current_return_start",st.optBoolean("returnToStart",false))
                .putString("current_route_name",st.optString("name","Nova rota")).apply();
        }catch(Exception ignored){}
    }

    private void switchMode(String next){
        if(next.equals(mode))return;
        if(MODE_DAY.equals(next)&&!companyLinked())return;
        persistState();
        mode=next;
        prefs.edit().putString("mode",mode).apply();
        loadState();
        applyMode();
        renderList();renderMap(lastPlan);refreshStartPointUi();
        if(dayMode()){
            if(stops.isEmpty()||System.currentTimeMillis()-dayLoadedAt>120000L)loadDay(false);
            else status.setText("Rota do dia. Toque em Atualizar para conferir novas entregas.");
        }else status.setText("Rota livre: digite ou fale o endereço. Rua e cidade já são suficientes.");
    }

    /** Mostra só o que faz sentido em cada modo. */
    private void applyMode(){
        final int NAVY=Color.rgb(22,20,47),MUTED=Color.rgb(91,105,135),LINE=Color.rgb(225,231,241);
        boolean day=dayMode(),linked=companyLinked();
        if(modeBar!=null)modeBar.setVisibility(linked?View.VISIBLE:View.GONE);
        if(modeDayButton!=null){
            modeDayButton.setBackground(day?bg(NAVY,14):strokedBg(Color.WHITE,LINE,14));modeDayButton.setTextColor(day?Color.WHITE:MUTED);
            modeFreeButton.setBackground(!day?bg(NAVY,14):strokedBg(Color.WHITE,LINE,14));modeFreeButton.setTextColor(!day?Color.WHITE:MUTED);
        }
        if(mapParams!=null&&map!=null){mapParams.height=dp(day?220:300);map.setLayoutParams(mapParams);}
        int free=day?View.GONE:View.VISIBLE;
        if(searchRowView!=null)searchRowView.setVisibility(free);
        if(startRowView!=null)startRowView.setVisibility(free);
        if(returnStartHome!=null){
            returnStartHome.setVisibility(free);
            boolean wanted=prefs.getBoolean("current_return_start",false);
            if(!day&&returnStartHome.isChecked()!=wanted)returnStartHome.setChecked(wanted);
        }
        if(shareRowView!=null)shareRowView.setVisibility(free);
        if(optimizeButton!=null)optimizeButton.setVisibility(free);
        if(editStopsButton!=null)editStopsButton.setVisibility(free);
        if(refreshDayButton!=null)refreshDayButton.setVisibility(day?View.VISIBLE:View.GONE);
        if(startRouteButton!=null)startRouteButton.setText(day?"Ir para a próxima entrega":"Iniciar rota");
        if(routeTitle!=null){
            if(day){
                String who=prefs.getString("company_driver",""),plate=prefs.getString("company_plate","");
                routeTitle.setText("Rota de hoje"+(plate.isEmpty()?"":" • "+plate));
                if(!who.isEmpty()&&status!=null&&stops.isEmpty())status.setText("Olá, "+who.split(" ")[0]+". Buscando as entregas de hoje…");
            }else routeTitle.setText(prefs.getString("current_route_name","Nova rota"));
        }
    }

    private void daySummary(){
        if(summary==null)return;
        int done=0;for(JSONObject x:stops)if(x.optBoolean("entregue",false))done++;
        String km=lastPlan!=null&&lastPlan.optDouble("distanceMeters",0)>0?" • "+fmtKm(lastPlan.optDouble("distanceMeters",0)):"";
        summary.setText(stops.size()+" entrega"+(stops.size()==1?"":"s")+" • "+done+" já entregue"+(done==1?"":"s")+km);
    }

    /** Busca na empresa as entregas do romaneio de hoje, já na ordem de rota. */
    private void loadDay(final boolean askedByUser){
        if(!companyLinked())return;
        if(dayLoading){dayReloadWanted=dayReloadWanted||askedByUser;return;}
        dayLoading=true;
        if(askedByUser||stops.isEmpty())status.setText("Buscando as entregas de hoje…");
        if(refreshDayButton!=null){refreshDayButton.setEnabled(false);refreshDayButton.setText("Atualizando…");}
        final String token=prefs.getString("company_token","");
        exec.execute(()->{
            try{
                final JSONObject j=Api.getAuth("/api/router-app/company/today"+(askedByUser?"?fresh=1":""),token);
                final ArrayList<JSONObject> list=new ArrayList<>();
                JSONArray arr=j.optJSONArray("stops");
                if(arr!=null)for(int i=0;i<arr.length();i++)list.add(arr.getJSONObject(i));
                runOnUiThread(()->{
                    dayLoading=false;dayLoadedAt=System.currentTimeMillis();
                    if(refreshDayButton!=null){refreshDayButton.setEnabled(true);refreshDayButton.setText("🔄 Atualizar entregas");}
                    // O vínculo mudou enquanto esta consulta estava a caminho: vale a nova.
                    if(dayReloadWanted||!token.equals(prefs.getString("company_token",""))){dayReloadWanted=false;dayLoadedAt=0L;loadDay(true);return;}
                    if(!dayMode())return;
                    if(j.optBoolean("building",false)){
                        // A empresa ainda está montando a rota (leitura do romaneio): mantém o que já
                        // está na tela e consulta de novo sozinho, por até uns 3 minutos.
                        status.setText(j.optString("message","Montando a rota de hoje…"));
                        if(dayBuildingTries++<14)new Handler(Looper.getMainLooper()).postDelayed(()->{if(dayMode())loadDay(false);},12000);
                        return;
                    }
                    dayBuildingTries=0;
                    try{
                        stops.clear();stops.addAll(list);
                        start=j.optJSONObject("start");
                        JSONObject pl=new JSONObject();
                        if(j.optJSONObject("geometry")!=null)pl.put("geometry",j.optJSONObject("geometry"));
                        pl.put("distanceMeters",j.optDouble("distanceMeters",0));
                        pl.put("durationSeconds",j.optDouble("durationSeconds",0));
                        lastPlan=pl;
                        prefs.edit().putBoolean("current_return_start",j.optBoolean("returnToStart",true)).apply();
                    }catch(Exception ignored){}
                    renderList();renderMap(lastPlan);
                    String msg=j.optString("message","");
                    if(stops.isEmpty())status.setText(msg.isEmpty()?"Ainda não há entregas para você hoje.":msg);
                    else{
                        JSONArray roms=j.optJSONArray("romaneios");
                        String rom=roms!=null&&roms.length()>0?" • Romaneio "+roms.optString(0)+(roms.length()>1?" +"+(roms.length()-1):""):"";
                        status.setText("Entregas de hoje na melhor ordem"+rom+".");
                    }
                });
            }catch(final Exception e){
                runOnUiThread(()->{
                    dayLoading=false;
                    if(refreshDayButton!=null){refreshDayButton.setEnabled(true);refreshDayButton.setText("🔄 Atualizar entregas");}
                    String m=String.valueOf(e.getMessage());
                    if(dayReloadWanted||!token.equals(prefs.getString("company_token",""))){dayReloadWanted=false;dayLoadedAt=0L;loadDay(true);return;}
                    if(m.contains("Vínculo")||m.contains("vinculado")){
                        // A empresa não reconhece mais este vínculo: volta para a rota livre.
                        prefs.edit().remove("company_token").apply();
                        mode=MODE_FREE;prefs.edit().putString("mode",mode).apply();
                        loadState();applyMode();renderList();renderMap(lastPlan);
                        status.setText("O vínculo com a empresa venceu. Abra a rota de novo pelo aplicativo CONSTRULOG Motorista.");
                    }else if(dayMode())status.setText("Sem conexão para atualizar. Mostrando a última rota recebida.");
                });
            }
        });
    }

    /** movit://empresa/<código>: aberto pelo app da empresa; vincula o celular e mostra a rota do dia. */
    private void claimCompanyCode(final String code){
        status.setText("Conectando com a empresa…");
        exec.execute(()->{
            try{
                JSONObject b=new JSONObject();b.put("code",code);
                final JSONObject j=Api.post("/api/router-app/company/claim",b);
                prefs.edit().putString("company_token",j.getString("company_token"))
                    .putString("company_name",j.optString("company","Empresa"))
                    .putString("company_driver",j.optString("driver_name",""))
                    .putString("company_plate",j.optString("vehicle_plate","")).apply();
                runOnUiThread(()->{
                    if(!dayMode()){persistState();mode=MODE_DAY;prefs.edit().putString("mode",mode).apply();loadState();}
                    applyMode();renderList();renderMap(lastPlan);
                    dayLoadedAt=0L;loadDay(true);
                });
            }catch(final Exception e){
                runOnUiThread(()->{
                    // Código já usado: se o celular já está vinculado, basta abrir a rota do dia.
                    if(companyLinked()){switchMode(MODE_DAY);if(dayMode())loadDay(true);}
                    else status.setText("Não foi possível conectar com a empresa: "+e.getMessage());
                });
            }
        });
    }

    @Override protected void onNewIntent(Intent intent){
        super.onNewIntent(intent);
        setIntent(intent);
        handleSharedRouteIntent(intent);
    }

    private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}
    private GradientDrawable bg(int color,float radius){
        GradientDrawable g=new GradientDrawable();g.setColor(color);g.setCornerRadius(dp((int)radius));return g;
    }
    private GradientDrawable strokedBg(int fill,int stroke,float radius){
        GradientDrawable g=bg(fill,radius);g.setStroke(dp(1),stroke);return g;
    }
    private TextView label(String text,int size,int color,boolean bold){
        TextView t=new TextView(this);t.setText(text);t.setTextSize(size);t.setTextColor(color);
        if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        return t;
    }
    private Button pill(String text,int fill,int textColor){
        Button b=new Button(this);
        b.setText(text);
        b.setTextColor(textColor);
        b.setTextSize(13);
        b.setAllCaps(false);
        b.setSingleLine(true);
        b.setGravity(Gravity.CENTER);
        b.setEllipsize(null);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setMinHeight(0);
        b.setMinimumHeight(0);
        b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        b.setBackground(bg(fill,14));
        b.setPadding(dp(8),dp(6),dp(8),dp(6));
        b.setStateListAnimator(null);
        return b;
    }
    private LinearLayout card(int padding){
        LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);l.setPadding(dp(padding),dp(padding),dp(padding),dp(padding));
        l.setBackground(bg(Color.WHITE,20));l.setElevation(dp(2));return l;
    }
    private void gap(ViewGroup parent,int h){
        Space s=new Space(this);parent.addView(s,new LinearLayout.LayoutParams(1,dp(h)));
    }

    private void buildUi(){
        final int NAVY=Color.rgb(22,20,47),BLUE=Color.rgb(47,115,232),GREEN=Color.rgb(99,202,67),BG=Color.rgb(248,250,253),TEXT=Color.rgb(22,27,45),MUTED=Color.rgb(91,105,135),LINE=Color.rgb(225,231,241);
        getWindow().setStatusBarColor(Color.WHITE);getWindow().setNavigationBarColor(Color.WHITE);
        if(Build.VERSION.SDK_INT>=23)getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        LinearLayout page=new LinearLayout(this);page.setOrientation(LinearLayout.VERTICAL);page.setBackgroundColor(BG);

        // Barra superior
        LinearLayout top=new LinearLayout(this);top.setOrientation(LinearLayout.HORIZONTAL);top.setGravity(Gravity.CENTER_VERTICAL);top.setPadding(dp(14),dp(8),dp(14),dp(8));top.setBackgroundColor(Color.WHITE);
        Button menu=pill("☰",Color.WHITE,NAVY);menu.setTextSize(22);menu.setOnClickListener(v->showMainMenu());
        top.addView(menu,new LinearLayout.LayoutParams(dp(48),dp(48)));
        LinearLayout topText=new LinearLayout(this);topText.setOrientation(LinearLayout.VERTICAL);topText.setPadding(dp(8),0,0,0);
        TextView movit=label("MOVIT",20,NAVY,true);
        TextView tag=label("Roteirizador",11,MUTED,false);
        topText.addView(movit);topText.addView(tag);top.addView(topText,new LinearLayout.LayoutParams(0,-2,1));
        Button settings=pill("⚙",Color.WHITE,NAVY);settings.setTextSize(20);settings.setOnClickListener(v->showSettings());
        top.addView(settings,new LinearLayout.LayoutParams(dp(48),dp(48)));
        page.addView(top);

        // Rota do dia × Rota livre (só aparece para quem está vinculado a uma empresa)
        modeBar=new LinearLayout(this);modeBar.setOrientation(LinearLayout.HORIZONTAL);modeBar.setPadding(dp(12),dp(2),dp(12),dp(8));modeBar.setBackgroundColor(Color.WHITE);
        modeDayButton=pill("📦 Rota do dia",NAVY,Color.WHITE);modeDayButton.setTextSize(14);modeDayButton.setOnClickListener(v->switchMode(MODE_DAY));
        modeFreeButton=pill("✏️ Rota livre",Color.WHITE,MUTED);modeFreeButton.setTextSize(14);modeFreeButton.setOnClickListener(v->switchMode(MODE_FREE));
        modeBar.addView(modeDayButton,new LinearLayout.LayoutParams(0,dp(44),1));
        LinearLayout.LayoutParams mfp=new LinearLayout.LayoutParams(0,dp(44),1);mfp.setMargins(dp(8),0,0,0);modeBar.addView(modeFreeButton,mfp);
        page.addView(modeBar);

        ScrollView outer=new ScrollView(this);outer.setFillViewport(true);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(12),0,dp(12),dp(18));
        outer.addView(root,new ScrollView.LayoutParams(-1,-2));page.addView(outer,new LinearLayout.LayoutParams(-1,0,1));

        // Mapa grande
        LinearLayout mapCard=card(0);mapCard.setClipToOutline(true);
        map=new WebView(this);map.getSettings().setJavaScriptEnabled(true);map.setBackgroundColor(Color.WHITE);
        mapParams=new LinearLayout.LayoutParams(-1,dp(300));
        mapCard.addView(map,mapParams);
        root.addView(mapCard);
        gap(root,8);

        // Busca estilo barra inferior do mapa
        LinearLayout searchRow=new LinearLayout(this);searchRow.setOrientation(LinearLayout.HORIZONTAL);searchRow.setGravity(Gravity.CENTER_VERTICAL);
        address=new EditText(this);address.setHint("Adicione ou busque uma parada");address.setSingleLine(true);address.setTextSize(15);address.setTextColor(TEXT);address.setHintTextColor(Color.rgb(139,151,176));address.setBackground(strokedBg(Color.WHITE,LINE,16));address.setPadding(dp(14),0,dp(10),0);
        searchRow.addView(address,new LinearLayout.LayoutParams(0,dp(52),1));
        Button voice=pill("🎤",Color.WHITE,BLUE);voice.setTextSize(22);voice.setPadding(0,0,0,0);voice.setOnClickListener(v->voice());
        LinearLayout.LayoutParams vp=new LinearLayout.LayoutParams(dp(58),dp(50));vp.setMargins(dp(8),0,0,0);searchRow.addView(voice,vp);
        Button add=pill("Adicionar",BLUE,Color.WHITE);add.setTextSize(13);add.setOnClickListener(v->addAddress(address.getText().toString()));
        LinearLayout.LayoutParams ap=new LinearLayout.LayoutParams(dp(96),dp(50));ap.setMargins(dp(6),0,0,0);searchRow.addView(add,ap);
        root.addView(searchRow);
        searchRowView=searchRow;

        status=label("Digite ou fale o endereço. Rua e cidade já são suficientes.",12,MUTED,false);status.setPadding(dp(4),dp(7),dp(4),dp(4));root.addView(status);

        // Resumo e nome da rota
        LinearLayout info=card(14);
        summary=label("0 min • 0 paradas • 0 km",14,MUTED,true);info.addView(summary);
        routeTitle=label(prefs.getString("current_route_name","Nova rota"),22,TEXT,true);routeTitle.setPadding(0,dp(7),0,dp(8));info.addView(routeTitle);

        LinearLayout startRow=new LinearLayout(this);startRow.setOrientation(LinearLayout.HORIZONTAL);startRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout startText=new LinearLayout(this);startText.setOrientation(LinearLayout.VERTICAL);
        TextView startTitle=label("Ponto de partida",12,MUTED,true);startText.addView(startTitle);
        startPointLabel=label("Será o primeiro endereço adicionado",14,TEXT,true);startPointLabel.setMaxLines(2);startText.addView(startPointLabel);
        startRow.addView(startText,new LinearLayout.LayoutParams(0,-2,1));
        Button changeStart=pill("Alterar",Color.WHITE,BLUE);changeStart.setBackground(strokedBg(Color.WHITE,LINE,12));changeStart.setOnClickListener(v->showStartPicker());
        LinearLayout.LayoutParams csp=new LinearLayout.LayoutParams(dp(88),dp(42));csp.setMargins(dp(8),0,0,0);startRow.addView(changeStart,csp);
        info.addView(startRow);
        startRowView=startRow;
        gap(info,8);

        refreshDayButton=pill("🔄 Atualizar entregas",Color.rgb(236,253,245),Color.rgb(6,95,70));
        refreshDayButton.setBackground(strokedBg(Color.rgb(236,253,245),Color.rgb(110,231,183),14));
        refreshDayButton.setOnClickListener(v->loadDay(true));
        LinearLayout.LayoutParams rdp=new LinearLayout.LayoutParams(-1,dp(48));rdp.setMargins(0,0,0,dp(8));
        info.addView(refreshDayButton,rdp);

        returnStartHome=new Switch(this);
        returnStartHome.setText("Terminar no mesmo local de início");
        returnStartHome.setTextColor(TEXT);
        returnStartHome.setTextSize(14);
        returnStartHome.setChecked(prefs.getBoolean("current_return_start",false));
        returnStartHome.setPadding(0,0,0,dp(8));
        returnStartHome.setOnCheckedChangeListener((buttonView,isChecked)->{
            prefs.edit().putBoolean("current_return_start",isChecked).apply();
            lastPlan=null;
            summary.setText(stops.size()+" parada"+(stops.size()==1?"":"s")+(isChecked?" • ida e volta":" • só ida"));
            status.setText(isChecked?"A rota terminará no mesmo local de início.":"A rota terminará na última parada.");
            renderMap(null);
        });
        info.addView(returnStartHome);

        // Ferramentas da rota: ficam depois da lista, para as paradas aparecerem sem rolar a tela.
        LinearLayout tools=card(14);
        TextView toolsTitle=label("Ferramentas da rota",13,MUTED,true);toolsTitle.setPadding(0,0,0,dp(8));tools.addView(toolsTitle);
        truckRestrictionsButton=pill("🚛 Ver restrições do caminhão",Color.rgb(255,248,235),Color.rgb(146,64,14));
        truckRestrictionsButton.setBackground(strokedBg(Color.rgb(255,248,235),Color.rgb(251,191,36),14));
        truckRestrictionsButton.setOnClickListener(v->analyzeTruckRestrictions(true));
        LinearLayout.LayoutParams trp=new LinearLayout.LayoutParams(-1,dp(48));trp.setMargins(0,0,0,dp(8));
        tools.addView(truckRestrictionsButton,trp);
        refreshTruckButton();

        fuelButton=pill("⛽ Postos na rota",Color.rgb(239,246,255),Color.rgb(30,64,175));
        fuelButton.setBackground(strokedBg(Color.rgb(239,246,255),Color.rgb(147,197,253),14));
        fuelButton.setOnClickListener(v->findFuelStations());
        LinearLayout.LayoutParams flp=new LinearLayout.LayoutParams(-1,dp(48));flp.setMargins(0,0,0,dp(8));
        tools.addView(fuelButton,flp);

        tollButton=pill("🛣 Pedágios da rota",Color.rgb(248,250,252),Color.rgb(51,65,85));
        tollButton.setBackground(strokedBg(Color.rgb(248,250,252),Color.rgb(203,213,225),14));
        tollButton.setOnClickListener(v->showTolls(true));
        LinearLayout.LayoutParams tlp=new LinearLayout.LayoutParams(-1,dp(48));tlp.setMargins(0,0,0,dp(8));
        tools.addView(tollButton,tlp);

        testTrackingButton=pill("🧪 Testar no mapa CONSTRULOG",Color.rgb(255,247,237),Color.rgb(154,52,18));
        testTrackingButton.setBackground(strokedBg(Color.rgb(255,247,237),Color.rgb(253,186,116),14));
        testTrackingButton.setOnClickListener(v->{if(testTrackingActive)stopConstrulogTest();else startConstrulogTest();});
        LinearLayout.LayoutParams testLp=new LinearLayout.LayoutParams(-1,dp(48));testLp.setMargins(0,0,0,dp(8));
        if(BuildConfig.PLAY_STORE_BUILD)testTrackingButton.setVisibility(View.GONE);
        else tools.addView(testTrackingButton,testLp);

        LinearLayout shareRow=new LinearLayout(this);shareRow.setOrientation(LinearLayout.HORIZONTAL);
        Button share=pill("↗  Compartilhar rota",Color.WHITE,BLUE);share.setBackground(strokedBg(Color.WHITE,LINE,14));share.setOnClickListener(v->shareRoute());
        Button save=pill("Salvar",Color.WHITE,NAVY);save.setBackground(strokedBg(Color.WHITE,LINE,14));save.setOnClickListener(v->saveCloud());
        shareRow.addView(share,new LinearLayout.LayoutParams(0,dp(48),1));
        LinearLayout.LayoutParams svp=new LinearLayout.LayoutParams(dp(96),dp(48));svp.setMargins(dp(8),0,0,0);shareRow.addView(save,svp);
        tools.addView(shareRow);
        shareRowView=shareRow;
        root.addView(info);

        gap(root,10);

        // Paradas
        LinearLayout stopsCard=card(12);
        LinearLayout stHead=new LinearLayout(this);stHead.setOrientation(LinearLayout.HORIZONTAL);stHead.setGravity(Gravity.CENTER_VERTICAL);
        TextView stopsTitle=label("Paradas",17,TEXT,true);stHead.addView(stopsTitle,new LinearLayout.LayoutParams(0,-2,1));
        Button edit=pill("Editar",Color.WHITE,BLUE);edit.setBackground(strokedBg(Color.WHITE,LINE,12));edit.setOnClickListener(v->status.setText("Use ↑ para mover e × para excluir uma parada."));
        stHead.addView(edit,new LinearLayout.LayoutParams(dp(82),dp(42)));stopsCard.addView(stHead);
        editStopsButton=edit;
        list=new LinearLayout(this);list.setOrientation(LinearLayout.VERTICAL);list.setPadding(0,dp(6),0,0);stopsCard.addView(list,new LinearLayout.LayoutParams(-1,-2));
        root.addView(stopsCard);

        gap(root,10);
        root.addView(tools);

        // Barra inferior de ação
        LinearLayout bottom=card(10);bottom.setOrientation(LinearLayout.HORIZONTAL);bottom.setGravity(Gravity.CENTER_VERTICAL);
        optimizeButton=pill("Otimizar rota",Color.WHITE,NAVY);optimizeButton.setTextSize(14);optimizeButton.setBackground(strokedBg(Color.WHITE,LINE,14));optimizeButton.setOnClickListener(v->optimize());
        Button startBtn=pill("Iniciar rota",BLUE,Color.WHITE);startBtn.setTextSize(14);startBtn.setOnClickListener(v->{if(dayMode()||lastPlan!=null)navigateFirst();else optimize();});
        startRouteButton=startBtn;
        bottom.addView(optimizeButton,new LinearLayout.LayoutParams(0,dp(56),1f));
        LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(0,dp(56),1f);sp.setMargins(dp(10),0,0,0);bottom.addView(startBtn,sp);
        // Fica sempre à vista: otimizar e iniciar não podem depender de rolar a tela até o fim.
        LinearLayout.LayoutParams bottomLp=new LinearLayout.LayoutParams(-1,-2);bottomLp.setMargins(dp(10),dp(4),dp(10),dp(8));
        page.addView(bottom,bottomLp);

        // objetos mantidos para compatibilidade
        account=label("Modo teste",11,MUTED,false);
        cloudSave=save;cloudRoutes=edit;

        setContentView(page);
    }

    private void showMainMenu(){
        final int NAVY=Color.rgb(22,20,47),BLUE=Color.rgb(47,115,232),TEXT=Color.rgb(22,27,45),MUTED=Color.rgb(91,105,135),LINE=Color.rgb(225,231,241);
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(dp(18),dp(10),dp(18),dp(14));
        TextView title=label("MOVIT",24,NAVY,true);box.addView(title);
        TextView test=label(BuildConfig.PLAY_STORE_BUILD?"Roteirizador MOVIT":"Modo de teste • sem cadastro",12,MUTED,false);test.setPadding(0,0,0,dp(14));box.addView(test);

        try{
            JSONArray rows=new JSONArray(prefs.getString("local_routes","[]"));
            TextView h=label("Rotas recentes",13,MUTED,true);box.addView(h);
            for(int i=0;i<Math.min(rows.length(),6);i++){
                final JSONObject row=rows.getJSONObject(i);
                Button b=pill(row.optString("name","Rota"),Color.WHITE,TEXT);b.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);b.setBackground(strokedBg(Color.WHITE,LINE,10));
                LinearLayout.LayoutParams bp=new LinearLayout.LayoutParams(-1,dp(48));bp.setMargins(0,dp(6),0,0);box.addView(b,bp);
                b.setOnClickListener(v->{openCloudRoute(row);});
            }
        }catch(Exception ignored){}

        Button create=pill("+  Criar rota",BLUE,Color.WHITE);create.setOnClickListener(v->showCreateRoute());
        LinearLayout.LayoutParams cp=new LinearLayout.LayoutParams(-1,dp(54));cp.setMargins(0,dp(16),0,0);box.addView(create,cp);
        Button saved=pill("Rotas salvas",Color.WHITE,NAVY);saved.setBackground(strokedBg(Color.WHITE,LINE,12));saved.setOnClickListener(v->loadCloudRoutes());
        LinearLayout.LayoutParams xp=new LinearLayout.LayoutParams(-1,dp(50));xp.setMargins(0,dp(8),0,0);box.addView(saved,xp);
        Button cfg=pill("Configurações",Color.WHITE,NAVY);cfg.setBackground(strokedBg(Color.WHITE,LINE,12));cfg.setOnClickListener(v->showSettings());
        LinearLayout.LayoutParams gp=new LinearLayout.LayoutParams(-1,dp(50));gp.setMargins(0,dp(8),0,0);box.addView(cfg,gp);

        new AlertDialog.Builder(this).setView(box).setNegativeButton("Fechar",null).show();
    }

    private void showCreateRoute(){
        final int TEXT=Color.rgb(22,27,45),MUTED=Color.rgb(91,105,135);
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(dp(20),dp(6),dp(20),0);
        TextView t=label("Criar rota",22,TEXT,true);box.addView(t);

        TextView nlab=label("Nome da rota ou do motorista",13,MUTED,false);nlab.setPadding(0,dp(16),0,dp(4));box.addView(nlab);
        EditText driver=new EditText(this);driver.setHint("Ex.: Júlio");driver.setText(prefs.getString("current_driver_name",""));box.addView(driver);

        // O romaneio só existe para quem é da empresa; na versão da loja o campo não aparece.
        TextView rlab=label("Número do romaneio (opcional)",13,MUTED,false);rlab.setPadding(0,dp(12),0,dp(4));box.addView(rlab);
        EditText romaneio=new EditText(this);romaneio.setHint("Ex.: TBT12345");romaneio.setText(prefs.getString("current_romaneio",""));romaneio.setSingleLine(true);box.addView(romaneio);
        if(BuildConfig.PLAY_STORE_BUILD&&!companyLinked()){rlab.setVisibility(View.GONE);romaneio.setVisibility(View.GONE);romaneio.setText("");}

        TextView dlab=label("Data do evento",13,MUTED,false);dlab.setPadding(0,dp(14),0,dp(4));box.addView(dlab);
        RadioGroup rg=new RadioGroup(this);rg.setOrientation(RadioGroup.VERTICAL);
        Calendar now=Calendar.getInstance(),tom=Calendar.getInstance();tom.add(Calendar.DAY_OF_MONTH,1);
        RadioButton today=new RadioButton(this);today.setText("Hoje  •  "+new java.text.SimpleDateFormat("dd/MM/yyyy",Locale.getDefault()).format(now.getTime()));today.setChecked(true);
        RadioButton tomorrow=new RadioButton(this);tomorrow.setText("Amanhã  •  "+new java.text.SimpleDateFormat("dd/MM/yyyy",Locale.getDefault()).format(tom.getTime()));
        RadioButton choose=new RadioButton(this);choose.setText("Escolher data");
        rg.addView(today);rg.addView(tomorrow);rg.addView(choose);box.addView(rg);

        final Calendar selected=Calendar.getInstance();
        TextView chosenDate=label(new java.text.SimpleDateFormat("dd/MM/yyyy",Locale.getDefault()).format(selected.getTime()),13,TEXT,true);chosenDate.setPadding(0,dp(6),0,0);box.addView(chosenDate);

        choose.setOnClickListener(v->{
            DatePickerDialog p=new DatePickerDialog(this,(view,year,month,day)->{
                selected.set(year,month,day);
                chosenDate.setText(new java.text.SimpleDateFormat("dd/MM/yyyy",Locale.getDefault()).format(selected.getTime()));
            },selected.get(Calendar.YEAR),selected.get(Calendar.MONTH),selected.get(Calendar.DAY_OF_MONTH));
            p.show();
        });
        today.setOnClickListener(v->{selected.setTime(new Date());chosenDate.setText(new java.text.SimpleDateFormat("dd/MM/yyyy",Locale.getDefault()).format(selected.getTime()));});
        tomorrow.setOnClickListener(v->{Calendar x=Calendar.getInstance();x.add(Calendar.DAY_OF_MONTH,1);selected.setTime(x.getTime());chosenDate.setText(new java.text.SimpleDateFormat("dd/MM/yyyy",Locale.getDefault()).format(selected.getTime()));});

        CheckBox reuse=new CheckBox(this);reuse.setText("Reutilizar paradas anteriores");reuse.setPadding(0,dp(10),0,0);box.addView(reuse);
        CheckBox returnStart=new CheckBox(this);returnStart.setText("Retornar ao mesmo ponto de saída");returnStart.setChecked(prefs.getBoolean("current_return_start",false));box.addView(returnStart);

        AlertDialog d=new AlertDialog.Builder(this).setView(box).setNegativeButton("Cancelar",null).setPositiveButton("Confirmar",null).create();
        d.setOnShowListener(x->d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            String driverName=driver.getText().toString().trim();
            String romaneioNumber=romaneio.getText().toString().trim();
            if(dayMode())switchMode(MODE_FREE);
            if(driverName.isEmpty())driverName="Minha rota";
            String eventDate=new java.text.SimpleDateFormat("yyyy-MM-dd",Locale.getDefault()).format(selected.getTime());
            String eventDateBr=new java.text.SimpleDateFormat("dd/MM/yyyy",Locale.getDefault()).format(selected.getTime());
            String routeName=driverName+" "+eventDateBr;
            prefs.edit()
                .putString("current_driver_name",driverName)
                .putString("current_romaneio",romaneioNumber)
                .putString("current_event_date",eventDate)
                .putString("current_route_name",routeName)
                .putBoolean("current_return_start",returnStart.isChecked())
                .apply();
            routeTitle.setText(routeName);
            if(returnStartHome!=null)returnStartHome.setChecked(returnStart.isChecked());
            if(!reuse.isChecked()){stops.clear();start=null;lastPlan=null;renderList();renderMap(null);}
            status.setText(returnStart.isChecked()?"Rota criada com retorno ao ponto de saída.":"Rota criada sem retorno ao ponto de saída.");
            d.dismiss();
        }));
        d.show();
    }

    private void showSettings(){
        final int TEXT=Color.rgb(22,27,45),MUTED=Color.rgb(91,105,135);
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(dp(20),dp(8),dp(20),dp(8));
        TextView title=label("Configurações",22,TEXT,true);box.addView(title);

        String[] navs={"Google Maps","Waze","Navegação do sistema"};
        String[] sides={"Qualquer lado do veículo","Lado direito","Lado esquerdo"};
        String[] times={"10 min","15 min","20 min","30 min","45 min","60 min"};
        String[] vehicles={"Carro","Van / Furgão","VUC","3/4","Toco","Truck","Carreta"};
        String[] ids={"Clássico e por ordem de rota","Somente número","Nome do cliente"};

        Spinner nav=new Spinner(this);nav.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,navs));nav.setSelection(prefs.getInt("cfg_nav",0));
        Spinner side=new Spinner(this);side.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,sides));side.setSelection(prefs.getInt("cfg_side",0));
        Spinner tm=new Spinner(this);tm.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,times));tm.setSelection(prefs.getInt("cfg_time",2));
        Spinner veh=new Spinner(this);veh.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,vehicles));veh.setSelection(prefs.getInt("cfg_vehicle",1));
        Spinner idsSp=new Spinner(this);idsSp.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,ids));idsSp.setSelection(prefs.getInt("cfg_ids",0));
        addSetting(box,"App de navegação",nav,MUTED,TEXT);
        addSetting(box,"Lado da parada",side,MUTED,TEXT);
        addSetting(box,"Tempo médio na parada",tm,MUTED,TEXT);
        addSetting(box,"Tipo de veículo",veh,MUTED,TEXT);

        EditText vehicleHeight=new EditText(this);vehicleHeight.setHint("Ex.: 3,20");vehicleHeight.setInputType(android.text.InputType.TYPE_CLASS_NUMBER|android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);vehicleHeight.setText(prefs.getString("cfg_vehicle_height",""));
        EditText vehicleWidth=new EditText(this);vehicleWidth.setHint("Ex.: 2,60");vehicleWidth.setInputType(android.text.InputType.TYPE_CLASS_NUMBER|android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);vehicleWidth.setText(prefs.getString("cfg_vehicle_width",""));
        EditText vehicleLength=new EditText(this);vehicleLength.setHint("Ex.: 14,00");vehicleLength.setInputType(android.text.InputType.TYPE_CLASS_NUMBER|android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);vehicleLength.setText(prefs.getString("cfg_vehicle_length",""));
        EditText vehicleWeight=new EditText(this);vehicleWeight.setHint("Ex.: 23,0");vehicleWeight.setInputType(android.text.InputType.TYPE_CLASS_NUMBER|android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);vehicleWeight.setText(prefs.getString("cfg_vehicle_weight",""));
        addSetting(box,"Altura do veículo (m)",vehicleHeight,MUTED,TEXT);
        addSetting(box,"Largura do veículo (m)",vehicleWidth,MUTED,TEXT);
        addSetting(box,"Comprimento do veículo (m)",vehicleLength,MUTED,TEXT);
        addSetting(box,"Peso total (t)",vehicleWeight,MUTED,TEXT);

        String[] axleOpts={"1","2","3","4","5","6","7","8","9"};
        Spinner vehicleAxles=new Spinner(this);vehicleAxles.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,axleOpts));
        vehicleAxles.setSelection(Math.max(0,Math.min(axleOpts.length-1,prefs.getInt("cfg_vehicle_axles",1)-1)));
        addSetting(box,"Número de eixos",vehicleAxles,MUTED,TEXT);

        Switch toll=new Switch(this);toll.setText("Evitar pedágios");toll.setChecked(prefs.getBoolean("cfg_toll",false));box.addView(toll);
        Switch returnStart=new Switch(this);returnStart.setText("Retornar ao ponto de saída");returnStart.setChecked(prefs.getBoolean("current_return_start",false));box.addView(returnStart);
        addSetting(box,"ID de parada",idsSp,MUTED,TEXT);
        Switch bubble=new Switch(this);bubble.setText("Balão do modo de navegação");bubble.setChecked(prefs.getBoolean("cfg_bubble",true));box.addView(bubble);

        new AlertDialog.Builder(this).setView(box).setNegativeButton("Cancelar",null).setPositiveButton("Salvar",(d,w)->{
            prefs.edit()
                .putInt("cfg_nav",nav.getSelectedItemPosition())
                .putInt("cfg_side",side.getSelectedItemPosition())
                .putInt("cfg_time",tm.getSelectedItemPosition())
                .putInt("cfg_vehicle",veh.getSelectedItemPosition())
                .putString("cfg_vehicle_name",String.valueOf(veh.getSelectedItem()))
                .putString("cfg_vehicle_height",vehicleHeight.getText().toString().trim())
                .putString("cfg_vehicle_width",vehicleWidth.getText().toString().trim())
                .putString("cfg_vehicle_length",vehicleLength.getText().toString().trim())
                .putString("cfg_vehicle_weight",vehicleWeight.getText().toString().trim())
                .putInt("cfg_vehicle_axles",vehicleAxles.getSelectedItemPosition()+1)
                .putInt("cfg_ids",idsSp.getSelectedItemPosition())
                .putBoolean("cfg_toll",toll.isChecked())
                .putBoolean("current_return_start",returnStart.isChecked())
                .putBoolean("cfg_bubble",bubble.isChecked()).apply();
            if(returnStartHome!=null)returnStartHome.setChecked(returnStart.isChecked());
            refreshTruckButton();
            status.setText("Configurações salvas.");
        }).show();
    }

    private void addSetting(LinearLayout box,String title,View control,int muted,int text){
        TextView t=label(title,14,text,true);t.setPadding(0,dp(14),0,0);box.addView(t);box.addView(control);
    }

    private void findFuelStations(){
        if(fuelDialog!=null&&fuelDialog.isShowing())return;
        if(fuelRequestRunning){status.setText("A consulta de postos já está em andamento.");return;}
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},REQ_FUEL_LOC);
            return;
        }
        try{
            LocationManager lm=(LocationManager)getSystemService(LOCATION_SERVICE);
            Location l=lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if(l==null)l=lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if(l==null){status.setText("Ainda não há localização disponível. Ative o GPS e tente novamente.");return;}
            fuelRequestRunning=true;
            if(fuelButton!=null){fuelButton.setEnabled(false);fuelButton.setText("⛽ Procurando postos…");}
            status.setText("Procurando postos próximos sem sair da rota…");
            final double lat=l.getLatitude(),lon=l.getLongitude();
            exec.execute(()->{
                try{
                    JSONObject body=new JSONObject();body.put("lat",lat);body.put("lon",lon);
                    if(lastPlan!=null&&lastPlan.optJSONObject("geometry")!=null)body.put("geometry",lastPlan.optJSONObject("geometry"));
                    JSONObject j=Api.post("/api/public-router/fuel-stations",body);
                    JSONArray rows=j.optJSONArray("rows");
                    runOnUiThread(()->showFuelStations(rows,j.optString("note","")));
                }catch(Exception e){runOnUiThread(()->{
                    fuelRequestRunning=false;
                    if(fuelButton!=null){fuelButton.setEnabled(true);fuelButton.setText("⛽ Postos na rota");}
                    status.setText("Postos: "+e.getMessage());
                });}
            });
        }catch(Exception e){fuelRequestRunning=false;status.setText("Não foi possível usar sua localização atual.");}
    }

    private void showFuelStations(JSONArray rows,String note){
        fuelRequestRunning=false;
        if(fuelButton!=null){fuelButton.setEnabled(true);fuelButton.setText("⛽ Postos na rota");}
        if(rows==null||rows.length()==0){
            if(fuelDialog!=null&&fuelDialog.isShowing())return;
            fuelDialog=new AlertDialog.Builder(this).setTitle("Postos na rota")
                .setMessage("Nenhum posto foi encontrado próximo do trajeto atual.\n\n"+note)
                .setPositiveButton("OK",null).create();
            fuelDialog.setOnDismissListener(d->fuelDialog=null);
            fuelDialog.show();
            status.setText("Nenhum posto encontrado próximo da rota.");
            return;
        }
        final ArrayList<JSONObject> list=new ArrayList<>();
        final ArrayList<String> labels=new ArrayList<>();
        for(int i=0;i<rows.length();i++){
            JSONObject r=rows.optJSONObject(i);if(r==null)continue;list.add(r);
            double km=r.optDouble("distanceMeters",0)/1000d;
            double off=r.isNull("routeOffsetMeters")?Double.NaN:r.optDouble("routeOffsetMeters",Double.NaN)/1000d;
            double ahead=r.isNull("aheadMeters")?Double.NaN:r.optDouble("aheadMeters",Double.NaN)/1000d;
            String line=r.optString("name","Posto de combustível");
            if(Double.isFinite(ahead))line+=" • "+String.format(Locale.forLanguageTag("pt-BR"),"%.1f km à frente",ahead);
            else line+=" • "+String.format(Locale.forLanguageTag("pt-BR"),"%.1f km",km);
            if(Double.isFinite(off))line+=" • "+String.format(Locale.forLanguageTag("pt-BR"),"%.1f km fora da rota",off);
            String hours=r.optString("openingHours","");if(!hours.isEmpty())line+="\nHorário: "+hours;
            labels.add(line);
        }
        if(fuelDialog!=null&&fuelDialog.isShowing())return;
        fuelDialog=new AlertDialog.Builder(this)
            .setTitle("⛽ Postos na rota")
            .setMessage(note)
            .setItems(labels.toArray(new String[0]),(d,which)->{
                if(which<0||which>=list.size())return;
                JSONObject r=list.get(which);
                String[] nav={"Google Maps","Waze"};
                new AlertDialog.Builder(this).setTitle(r.optString("name","Posto de combustível"))
                    .setItems(nav,(d2,w)->{
                        JSONObject s=new JSONObject();
                        try{s.put("lat",r.optDouble("lat"));s.put("lon",r.optDouble("lon"));}catch(Exception ignored){}
                        if(w==0)openStopInMaps(s);else openStopInWaze(s);
                    }).setNegativeButton("Cancelar",null).show();
            })
            .setNegativeButton("Fechar",null).create();
        fuelDialog.setOnDismissListener(d->fuelDialog=null);
        fuelDialog.show();
        status.setText(rows.length()+" posto(s) encontrado(s) próximo(s) da rota.");
    }

    private JSONArray avoidedTolls(){
        try{return new JSONArray(prefs.getString("cfg_avoided_tolls","[]"));}
        catch(Exception e){return new JSONArray();}
    }

    private boolean isAvoidedToll(JSONObject toll){
        JSONArray arr=avoidedTolls();
        double lat=toll.optDouble("lat",Double.NaN),lon=toll.optDouble("lon",Double.NaN);
        for(int i=0;i<arr.length();i++){
            JSONObject x=arr.optJSONObject(i);if(x==null)continue;
            double xlat=x.optDouble("lat",Double.NaN),xlon=x.optDouble("lon",Double.NaN);
            if(Double.isFinite(lat)&&Double.isFinite(lon)&&Double.isFinite(xlat)&&Double.isFinite(xlon)
                &&Math.abs(lat-xlat)<0.0008&&Math.abs(lon-xlon)<0.0008)return true;
        }
        return false;
    }

    private void setAvoidedToll(JSONObject toll,boolean avoid){
        JSONArray old=avoidedTolls(),next=new JSONArray();
        double lat=toll.optDouble("lat",Double.NaN),lon=toll.optDouble("lon",Double.NaN);
        for(int i=0;i<old.length();i++){
            JSONObject x=old.optJSONObject(i);if(x==null)continue;
            double xlat=x.optDouble("lat",Double.NaN),xlon=x.optDouble("lon",Double.NaN);
            boolean same=Double.isFinite(lat)&&Double.isFinite(lon)&&Double.isFinite(xlat)&&Double.isFinite(xlon)
                &&Math.abs(lat-xlat)<0.0008&&Math.abs(lon-xlon)<0.0008;
            if(!same)next.put(x);
        }
        if(avoid){
            JSONObject x=new JSONObject();
            try{
                x.put("name",toll.optString("name","Praça de pedágio"));
                x.put("operator",toll.optString("operator",""));
                x.put("lat",lat);x.put("lon",lon);
                next.put(x);
            }catch(Exception ignored){}
        }
        prefs.edit().putString("cfg_avoided_tolls",next.toString()).apply();
    }

    private void showTollAction(JSONObject toll){
        boolean avoided=isAvoidedToll(toll);
        StringBuilder msg=new StringBuilder();
        String op=toll.optString("operator","");
        if(!op.isEmpty())msg.append(op).append("\n");
        double km=toll.optDouble("kmFromStart",Double.NaN);
        if(Double.isFinite(km))msg.append("Km aproximado na rota: ").append(String.format(Locale.forLanguageTag("pt-BR"),"%.1f",km)).append("\n");
        if(!toll.isNull("amount"))msg.append("Valor: ").append(brl(toll.optDouble("amount",0))).append("\n");
        msg.append(avoided?"Este pedágio está marcado para ser evitado.":"O MOVIT tentará encontrar uma rota alternativa que não passe por esta praça.");
        new AlertDialog.Builder(this)
            .setTitle(toll.optString("name","Praça de pedágio"))
            .setMessage(msg.toString())
            .setPositiveButton(avoided?"Voltar a usar este pedágio":"Evitar este pedágio",(d,w)->{
                setAvoidedToll(toll,!avoided);
                status.setText(avoided?"Pedágio liberado novamente. Recalculando rota…":"Pedágio removido da rota. Procurando caminho alternativo…");
                optimize();
            })
            .setNegativeButton("Cancelar",null)
            .show();
    }

    private void showTolls(boolean openDialog){
        if(openDialog&&tollDialog!=null&&tollDialog.isShowing())return;
        if(tollRequestRunning){if(openDialog)status.setText("O cálculo de pedágios já está em andamento.");return;}
        if(lastPlan==null||lastPlan.optJSONObject("geometry")==null){
            status.setText("Primeiro termine de lançar as paradas e toque em Otimizar rota.");
            if(openDialog)new AlertDialog.Builder(this)
                .setTitle("Pedágios da rota")
                .setMessage("Os pedágios são calculados sobre o caminho otimizado. Termine de lançar todas as entregas e toque em Otimizar rota.")
                .setPositiveButton("OK",null).show();
            return;
        }
        tollRequestRunning=true;
        if(tollButton!=null){tollButton.setEnabled(false);tollButton.setText("🛣 Calculando pedágios…");}
        exec.execute(()->{
            try{
                JSONObject body=new JSONObject();
                body.put("geometry",lastPlan.optJSONObject("geometry"));
                body.put("vehicle",vehicleProfile());
                JSONArray routeLocations=new JSONArray();
                JSONArray planPoints=lastPlan.optJSONArray("points");
                if(planPoints!=null){
                    for(int i=0;i<planPoints.length();i++){
                        JSONObject p=planPoints.optJSONObject(i);if(p==null)continue;
                        double lat=p.optDouble("lat",Double.NaN),lon=p.optDouble("lon",Double.NaN);
                        if(Double.isFinite(lat)&&Double.isFinite(lon))routeLocations.put(lat+","+lon);
                    }
                }
                if(prefs.getBoolean("current_return_start",false)&&routeLocations.length()>0)routeLocations.put(routeLocations.optString(0));
                body.put("locations",routeLocations);
                JSONObject j=Api.post("/api/public-router/tolls",body);
                JSONArray rows=j.optJSONArray("rows");
                runOnUiThread(()->{
                    tollRequestRunning=false;
                    if(tollButton!=null){
                        tollButton.setEnabled(true);
                        if(j.optBoolean("totalComplete",false))tollButton.setText("🛣 Pedágios • "+brl(j.optDouble("total",0)));
                        else tollButton.setText("🛣 Pedágios • "+j.optInt("count",0)+" praça(s)");
                    }
                    if(!openDialog)return;
                    if(rows==null||rows.length()==0){
                        if(tollDialog!=null&&tollDialog.isShowing())return;
                        tollDialog=new AlertDialog.Builder(this).setTitle("🛣 Pedágios da rota")
                            .setMessage("Nenhuma praça de pedágio cadastrada foi encontrada neste trajeto.\n\n"+j.optString("warning",""))
                            .setPositiveButton("OK",null).create();
                        tollDialog.setOnDismissListener(d->tollDialog=null);
                        tollDialog.show();
                        status.setText("Nenhum pedágio encontrado na rota.");
                        return;
                    }
                    final ArrayList<JSONObject> tolls=new ArrayList<>();
                    final ArrayList<String> labels=new ArrayList<>();
                    for(int i=0;i<rows.length();i++){
                        JSONObject p=rows.optJSONObject(i);if(p==null)continue;
                        tolls.add(p);
                        String line=p.optString("name","Praça de pedágio");
                        double km=p.optDouble("kmFromStart",Double.NaN);
                        if(Double.isFinite(km))line+=" • km "+String.format(Locale.forLanguageTag("pt-BR"),"%.1f",km);
                        if(!p.isNull("amount"))line+="\n"+brl(p.optDouble("amount",0))+(p.optBoolean("estimated",false)?" • estimado pelos eixos":"");
                        else line+="\nTarifa não cadastrada";
                        String op=p.optString("operator","");if(!op.isEmpty())line+=" • "+op;
                        if(isAvoidedToll(p))line+="\n✓ Marcado para evitar";
                        labels.add(line);
                    }
                    String title="🛣 Pedágios • "+j.optInt("count",0)+" praça(s)";
                    if(j.optInt("pricedCount",0)>0)title+=" • "+brl(j.optDouble("total",0));
                    if(tollDialog!=null&&tollDialog.isShowing())return;
                    tollDialog=new AlertDialog.Builder(this)
                        .setTitle(title)
                        .setItems(labels.toArray(new String[0]),(d,which)->{
                            if(which>=0&&which<tolls.size())showTollAction(tolls.get(which));
                        })
                        .setNegativeButton("Fechar",null)
                        .create();
                    tollDialog.setOnDismissListener(d->tollDialog=null);
                    tollDialog.show();
                    status.setText(j.optInt("count",0)+" praça(s) de pedágio encontrada(s). Toque em uma para evitar.");
                });
            }catch(Exception e){runOnUiThread(()->{
                tollRequestRunning=false;
                if(tollButton!=null){tollButton.setEnabled(true);tollButton.setText("🛣 Pedágios da rota");}
                if(openDialog)status.setText("Pedágios: "+e.getMessage());
            });}
        });
    }

    private String brl(double value){
        return java.text.NumberFormat.getCurrencyInstance(new Locale("pt","BR")).format(value);
    }

    private String vehicleType(){
        String saved=prefs.getString("cfg_vehicle_name","");
        if(!saved.isEmpty())return saved;
        String[] vehicles={"Carro","Van / Furgão","VUC","3/4","Toco","Truck","Carreta"};
        int idx=Math.max(0,Math.min(vehicles.length-1,prefs.getInt("cfg_vehicle",0)));
        return vehicles[idx];
    }

    private boolean isTruckVehicle(){
        String v=vehicleType().toLowerCase(Locale.ROOT);
        return v.contains("vuc")||v.contains("3/4")||v.contains("toco")||v.contains("truck")||v.contains("carreta")||v.contains("caminh");
    }

    private void refreshTruckButton(){
        if(truckRestrictionsButton==null)return;
        if(isTruckVehicle()){
            truckRestrictionsButton.setText("🚛 Ver restrições • "+vehicleType());
            truckRestrictionsButton.setVisibility(View.VISIBLE);
        }else{
            truckRestrictionsButton.setText("🚛 Configurar caminhão / restrições");
            truckRestrictionsButton.setVisibility(View.VISIBLE);
        }
    }

    private JSONObject vehicleProfile()throws Exception{
        JSONObject v=new JSONObject();
        v.put("type",vehicleType());
        v.put("heightM",prefs.getString("cfg_vehicle_height",""));
        v.put("widthM",prefs.getString("cfg_vehicle_width",""));
        v.put("lengthM",prefs.getString("cfg_vehicle_length",""));
        v.put("weightT",prefs.getString("cfg_vehicle_weight",""));
        v.put("axles",prefs.getInt("cfg_vehicle_axles",isTruckVehicle()?2:1));
        return v;
    }

    private void analyzeTruckRestrictions(boolean showDialog){
        if(showDialog&&restrictionDialog!=null&&restrictionDialog.isShowing())return;
        if(restrictionRequestRunning){if(showDialog)status.setText("A análise de restrições já está em andamento.");return;}
        if(!isTruckVehicle()){
            if(showDialog)new AlertDialog.Builder(this)
                .setTitle("Perfil do veículo")
                .setMessage("Selecione VUC, 3/4, Toco, Truck ou Carreta em Configurações para analisar restrições de caminhão.")
                .setNegativeButton("Cancelar",null)
                .setPositiveButton("Configurar",(d,w)->showSettings()).show();
            return;
        }
        if(stops.isEmpty()){
            if(showDialog)status.setText("Adicione os endereços da rota antes de verificar restrições.");
            return;
        }
        restrictionRequestRunning=true;
        if(showDialog)status.setText("Verificando restrições para "+vehicleType()+"…");
        exec.execute(()->{
            try{
                JSONObject body=new JSONObject();
                body.put("vehicle",vehicleProfile());
                JSONArray pts=new JSONArray();
                if(start!=null)pts.put(new JSONObject(start.toString()));
                for(JSONObject s:stops)pts.put(new JSONObject(s.toString()));
                body.put("points",pts);
                if(lastPlan!=null&&lastPlan.optJSONObject("geometry")!=null)body.put("geometry",lastPlan.optJSONObject("geometry"));
                JSONObject j=Api.post("/api/public-router/truck-restrictions",body);
                JSONArray alerts=j.optJSONArray("alerts");
                int count=j.optInt("count",alerts==null?0:alerts.length());
                runOnUiThread(()->{
                    restrictionRequestRunning=false;
                    if(truckRestrictionsButton!=null){
                        truckRestrictionsButton.setText(count>0?"⚠ "+count+" alerta"+(count==1?"":"s")+" de caminhão":"✓ Sem alerta cadastrado • "+vehicleType());
                    }
                    if(!showDialog)return;
                    StringBuilder msg=new StringBuilder();
                    msg.append("Veículo: ").append(vehicleType()).append("\n\n");
                    if(alerts==null||alerts.length()==0){
                        msg.append("Nenhuma restrição cadastrada foi encontrada nos endereços desta rota.\n\n");
                    }else{
                        for(int i=0;i<alerts.length();i++){
                            JSONObject a=alerts.optJSONObject(i);if(a==null)continue;
                            msg.append("⚠ ").append(a.optString("title","Restrição")).append("\n");
                            String street=a.optString("street","");if(!street.isEmpty())msg.append(street).append("\n");
                            String schedule=a.optString("schedule","");if(!schedule.isEmpty())msg.append("Horário: ").append(schedule).append("\n");
                            String detail=a.optString("detail","");if(!detail.isEmpty())msg.append(detail).append("\n");
                            msg.append("\n");
                        }
                    }
                    msg.append(j.optString("coverage","")).append("\n\n").append(j.optString("warning",""));
                    if(restrictionDialog!=null&&restrictionDialog.isShowing())return;
                    restrictionDialog=new AlertDialog.Builder(this).setTitle("Restrições para caminhão").setMessage(msg.toString()).setPositiveButton("OK",null).create();
                    restrictionDialog.setOnDismissListener(d->restrictionDialog=null);
                    restrictionDialog.show();
                    status.setText(count>0?count+" alerta(s) encontrado(s) para o veículo.":"Nenhuma restrição cadastrada encontrada nesta rota.");
                });
            }catch(Exception e){runOnUiThread(()->{
                restrictionRequestRunning=false;
                if(showDialog)status.setText("Restrições: "+e.getMessage());
            });}
        });
    }

    private void shareRoute(){
        if(stops.isEmpty()){status.setText("Adicione paradas antes de compartilhar.");return;}
        final String driver=prefs.getString("current_driver_name","Motorista");
        final String romaneio=prefs.getString("current_romaneio","");
        final String eventDateIso=prefs.getString("current_event_date",new java.text.SimpleDateFormat("yyyy-MM-dd",Locale.getDefault()).format(new Date()));
        final boolean hasRomaneio=!romaneio.trim().isEmpty();
        String dateBr=eventDateIso;
        try{
            Date parsed=new java.text.SimpleDateFormat("yyyy-MM-dd",Locale.getDefault()).parse(eventDateIso);
            if(parsed!=null)dateBr=new java.text.SimpleDateFormat("dd/MM/yyyy",Locale.getDefault()).format(parsed);
        }catch(Exception ignored){}
        final String eventDateBr=dateBr;
        final String title=driver+" "+eventDateBr;
        status.setText(hasRomaneio?"Exportando rota para a CONSTRULOG…":"Preparando o link da rota…");
        exec.execute(()->{
            try{
                JSONObject exported=new JSONObject();
                if(hasRomaneio){
                    JSONObject exportBody=new JSONObject();
                    exportBody.put("romaneio",romaneio);
                    exportBody.put("driver_name",driver);
                    exportBody.put("event_date",eventDateIso);
                    exportBody.put("title",title);
                    exportBody.put("route_data",currentRouteData());
                    exported=Api.post("/api/public-router/export-construlog",exportBody);
                    if(!exported.optBoolean("ok",false))throw new Exception(exported.optString("error","Falha ao enviar rota à CONSTRULOG."));
                }

                JSONObject body=new JSONObject();
                body.put("driver_name",driver);
                body.put("event_date",eventDateIso);
                body.put("title",title);
                body.put("route_data",currentRouteData());
                JSONObject j=Api.post("/api/public-router/share",body);
                final String link=j.getString("shareUrl");
                final String msg="Rota MOVIT - "+driver+" - "+eventDateBr+(hasRomaneio?" - Romaneio "+romaneio:"")+"\n"+link;
                final boolean linked=exported.optBoolean("linked_to_tracking",false);
                runOnUiThread(()->{
                    showShareOptions(title,msg,link);
                    status.setText(!hasRomaneio?"Link da rota pronto para compartilhar.":(linked?"Rota exportada e associada ao rastreamento CONSTRULOG.":"Rota exportada para a CONSTRULOG e pronta para compartilhar."));
                });
            }catch(Exception e){runOnUiThread(()->status.setText("Exportar: "+e.getMessage()));}
        });
    }

    private void showShareOptions(String title,String msg,String link){
        final String[] options={"WhatsApp","Copiar link","Outros aplicativos"};
        new AlertDialog.Builder(this)
            .setTitle("Compartilhar rota")
            .setItems(options,(d,which)->{
                if(which==0){
                    try{
                        Intent send=new Intent(Intent.ACTION_SEND);
                        send.setType("text/plain");
                        send.setPackage("com.whatsapp");
                        send.putExtra(Intent.EXTRA_TEXT,msg);
                        startActivity(send);
                    }catch(Exception e){
                        status.setText("WhatsApp não encontrado. Use Copiar link ou Outros aplicativos.");
                    }
                }else if(which==1){
                    ClipboardManager cm=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
                    if(cm!=null)cm.setPrimaryClip(ClipData.newPlainText(title,link));
                    status.setText("Link da rota copiado.");
                }else{
                    Intent send=new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_SUBJECT,title);
                    send.putExtra(Intent.EXTRA_TEXT,msg);
                    startActivity(Intent.createChooser(send,"Compartilhar rota"));
                }
            })
            .setNegativeButton("Cancelar",null)
            .show();
    }

    private void handleSharedRouteIntent(Intent intent){
        if(intent==null||intent.getData()==null)return;
        Uri data=intent.getData();
        if(!"movit".equalsIgnoreCase(data.getScheme()))return;
        if("empresa".equalsIgnoreCase(data.getHost())){
            String code=data.getLastPathSegment();
            intent.setData(null);   // não repete o vínculo se a tela for recriada
            if(code!=null&&code.matches("[a-fA-F0-9]{24}"))claimCompanyCode(code.toLowerCase(Locale.US));
            return;
        }
        if(!"route".equalsIgnoreCase(data.getHost()))return;
        String token=data.getLastPathSegment();
        if(token==null||token.length()<10)return;
        if(dayMode())switchMode(MODE_FREE);   // rota recebida por link abre na rota livre
        status.setText("Abrindo rota compartilhada…");
        exec.execute(()->{
            try{
                JSONObject j=Api.get("/api/public-router/share/"+URLEncoder.encode(token,"UTF-8"));
                JSONObject route=j.optJSONObject("route_data");
                if(route==null)throw new Exception("Rota compartilhada inválida.");
                JSONArray arr=route.optJSONArray("stops");
                stops.clear();
                if(arr!=null)for(int i=0;i<arr.length();i++)stops.add(arr.getJSONObject(i));
                start=route.optJSONObject("start");
                prefs.edit().putBoolean("current_return_start",route.optBoolean("returnToStart",false)).apply();
                lastPlan=null;
                // A central já mandou a rota roteirizada (trajeto e km): abre pronta para iniciar,
                // na ordem que a central definiu, sem precisar otimizar de novo.
                if(route.optJSONObject("geometry")!=null&&route.optDouble("distanceMeters",0)>0&&!stops.isEmpty()){
                    JSONObject pl=new JSONObject();
                    pl.put("geometry",route.optJSONObject("geometry"));
                    pl.put("distanceMeters",route.optDouble("distanceMeters",0));
                    pl.put("durationSeconds",route.optDouble("durationSeconds",0));
                    lastPlan=pl;
                }
                final JSONObject planned=lastPlan;
                String title=j.optString("title","Rota compartilhada");
                String driver=j.optString("driver_name","");
                String eventDate=j.optString("event_date","");
                prefs.edit()
                    .putString("current_route_name",title)
                    .putString("current_driver_name",driver)
                    .putString("current_romaneio",route.optString("romaneio",""))
                    .putString("current_event_date",eventDate)
                    .apply();
                runOnUiThread(()->{
                    routeTitle.setText(title);
                    refreshStartPointUi();
                    renderList();
                    renderMap(planned);
                    if(planned!=null){
                        summary.setText(stops.size()+" entrega"+(stops.size()==1?"":"s")+" • "+fmtKm(planned.optDouble("distanceMeters",0))+(prefs.getBoolean("current_return_start",false)?" • retorna ao início":" • só ida"));
                        status.setText("Rota da central aberta, já na ordem de entrega. Toque em Iniciar rota.");
                    }else status.setText("Rota compartilhada aberta. Toque em Otimizar para atualizar o trajeto.");
                });
            }catch(Exception e){runOnUiThread(()->status.setText("Abrir rota: "+e.getMessage()));}
        });
    }

    private void startConstrulogTest(){
        final String driver=prefs.getString("current_driver_name","").trim();
        final String romaneio=prefs.getString("current_romaneio","").trim();
        final String eventDate=prefs.getString("current_event_date",new java.text.SimpleDateFormat("yyyy-MM-dd",Locale.getDefault()).format(new Date()));
        if(driver.isEmpty()){status.setText("Crie a rota e informe o motorista antes do teste.");return;}
        if(romaneio.isEmpty()){status.setText("Informe o romaneio CONSTRULOG antes do teste.");return;}
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},REQ_TEST_LOC);
            return;
        }
        if(testTrackingButton!=null){testTrackingButton.setEnabled(false);testTrackingButton.setText("Iniciando teste…");}
        status.setText("Associando este celular ao romaneio "+romaneio+"…");
        exec.execute(()->{
            try{
                JSONObject b=new JSONObject();
                b.put("driver_name",driver);
                b.put("romaneio",romaneio);
                b.put("event_date",eventDate);
                b.put("title",prefs.getString("current_route_name",driver+" "+eventDate));
                b.put("route_data",currentRouteData());
                JSONObject j=Api.post("/api/public-router/test-tracking/start",b);
                testTrackingToken=j.getString("token");
                prefs.edit().putString("test_tracking_token",testTrackingToken).apply();
                runOnUiThread(()->{
                    testTrackingActive=true;
                    if(testTrackingButton!=null){testTrackingButton.setEnabled(true);testTrackingButton.setText("Parar teste CONSTRULOG");}
                    status.setText("TESTE ATIVO • "+driver+" • Romaneio "+romaneio+". Sua posição já pode aparecer no mapa.");
                    beginTestLocationUpdates();
                });
            }catch(Exception e){
                runOnUiThread(()->{
                    if(testTrackingButton!=null){testTrackingButton.setEnabled(true);testTrackingButton.setText("🧪 Testar no mapa CONSTRULOG");}
                    status.setText("Teste CONSTRULOG: "+e.getMessage());
                });
            }
        });
    }

    private void beginTestLocationUpdates(){
        try{
            if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED)return;
            testLocationManager=(LocationManager)getSystemService(LOCATION_SERVICE);
            if(testLocationListener!=null){
                try{testLocationManager.removeUpdates(testLocationListener);}catch(Exception ignored){}
            }
            testLocationListener=new LocationListener(){
                @Override public void onLocationChanged(Location location){sendTestLocation(location);}
                @Override public void onProviderEnabled(String provider){}
                @Override public void onProviderDisabled(String provider){}
                @Override public void onStatusChanged(String provider,int statusCode,Bundle extras){}
            };
            boolean gps=testLocationManager.isProviderEnabled(LocationManager.GPS_PROVIDER);
            boolean net=testLocationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
            if(gps)testLocationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER,10000L,5f,testLocationListener);
            if(net)testLocationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,15000L,10f,testLocationListener);
            Location last=null;
            if(gps)last=testLocationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if(last==null&&net)last=testLocationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if(last!=null)sendTestLocation(last);
            if(!gps&&!net)status.setText("Teste iniciado, mas o GPS está desligado.");
        }catch(Exception e){status.setText("Teste ativo, mas não consegui iniciar o GPS: "+e.getMessage());}
    }

    private void sendTestLocation(Location l){
        if(!testTrackingActive||l==null||testTrackingToken==null||testTrackingToken.isEmpty())return;
        final String token=testTrackingToken;
        final double lat=l.getLatitude(),lon=l.getLongitude();
        final float acc=l.hasAccuracy()?l.getAccuracy():0f;
        exec.execute(()->{
            try{
                JSONObject b=new JSONObject();
                b.put("latitude",lat);b.put("longitude",lon);b.put("accuracy_m",acc);
                b.put("captured_at",new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX",Locale.getDefault()).format(new Date()));
                Api.postAuth("/api/tracking/test/point",b,token);
                runOnUiThread(()->status.setText("TESTE ATIVO • posição enviada à CONSTRULOG às "+new java.text.SimpleDateFormat("HH:mm:ss",Locale.getDefault()).format(new Date())));
            }catch(Exception e){runOnUiThread(()->status.setText("Teste ativo • falha ao enviar GPS: "+e.getMessage()));}
        });
    }

    private void stopConstrulogTest(){
        testTrackingActive=false;
        try{
            if(testLocationManager!=null&&testLocationListener!=null)testLocationManager.removeUpdates(testLocationListener);
        }catch(Exception ignored){}
        testLocationListener=null;
        if(testTrackingButton!=null){testTrackingButton.setEnabled(true);testTrackingButton.setText("🧪 Testar no mapa CONSTRULOG");}
        status.setText("Teste CONSTRULOG encerrado neste celular.");
    }

    private void refreshStartPointUi(){
        if(startPointLabel==null)return;
        if(start==null){
            startPointLabel.setText("Será o primeiro endereço adicionado");
            return;
        }
        String text=start.optString("resolved",start.optString("label","Ponto de partida"));
        startPointLabel.setText(text);
    }

    private void showStartPicker(){
        ArrayList<String> labels=new ArrayList<>();
        labels.add("📍 Usar localização atual");
        for(int i=0;i<stops.size();i++){
            JSONObject s=stops.get(i);
            labels.add((i+1)+". "+s.optString("resolved",s.optString("label","Parada")));
        }
        new AlertDialog.Builder(this)
            .setTitle("Alterar ponto de partida")
            .setItems(labels.toArray(new String[0]),(d,which)->{
                if(which==0){
                    useLocation();
                    return;
                }
                int idx=which-1;
                if(idx>=0&&idx<stops.size()){
                    try{
                        start=new JSONObject(stops.get(idx).toString());
                        lastPlan=null;
                        refreshStartPointUi();
                        renderMap(null);
                        status.setText("Ponto de partida alterado para "+start.optString("resolved",start.optString("label","endereço selecionado"))+(prefs.getBoolean("current_return_start",true)?". O retorno será no mesmo local.":"."));
                    }catch(Exception e){status.setText("Não foi possível alterar o ponto de partida.");}
                }
            })
            .setNegativeButton("Cancelar",null)
            .show();
    }

    private void voice(){
        Intent i=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"pt-BR");
        i.putExtra(RecognizerIntent.EXTRA_PROMPT,"Fale o endereço completo. Você pode fazer pequenas pausas.");
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS,true);

        // Dá mais tempo para o motorista concluir rua, número e cidade.
        // Alguns aparelhos encerram o reconhecimento com pausas muito curtas;
        // estes valores deixam a captura mais tolerante.
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS,8000L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,3500L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS,5000L);

        try{startActivityForResult(i,REQ_VOICE);}catch(Exception e){status.setText("Reconhecimento de voz indisponível.");}
    }

    @Override protected void onActivityResult(int req,int res,Intent data){
        super.onActivityResult(req,res,data);
        if(req==REQ_VOICE&&res==RESULT_OK&&data!=null){
            ArrayList<String> out=data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if(out!=null&&!out.isEmpty()){
                String spoken=out.get(0);
                address.setText(spoken);
                status.setText("Procurando endereços com esse nome em todo o Brasil…");
                addAddress(spoken,true);
            }
        }
    }

    private void useLocation(){
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},REQ_LOC);return;
        }
        try{
            LocationManager lm=(LocationManager)getSystemService(LOCATION_SERVICE);
            Location l=lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if(l==null)l=lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if(l==null){status.setText("Ainda não há posição disponível. Abra o GPS e tente novamente.");return;}
            start=new JSONObject();start.put("lat",l.getLatitude());start.put("lon",l.getLongitude());start.put("label","Localização atual");start.put("resolved","Localização atual");
            lastPlan=null;refreshStartPointUi();renderMap(null);
            status.setText("Localização atual definida como ponto de partida"+(prefs.getBoolean("current_return_start",true)?" e retorno.":"."));
        }catch(Exception e){status.setText("Não foi possível usar sua localização.");}
    }

    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){
        super.onRequestPermissionsResult(requestCode,permissions,grantResults);
        if(requestCode==REQ_LOC&&grantResults.length>0&&grantResults[0]==PackageManager.PERMISSION_GRANTED)useLocation();
        if(requestCode==REQ_TEST_LOC&&grantResults.length>0&&grantResults[0]==PackageManager.PERMISSION_GRANTED)startConstrulogTest();
        if(requestCode==REQ_FUEL_LOC&&grantResults.length>0&&grantResults[0]==PackageManager.PERMISSION_GRANTED)findFuelStations();
    }

    private void addAddress(String raw){
        addAddress(raw,false);
    }

    private void addAddress(String raw,boolean reopenVoice){
        raw=raw.trim();
        if(raw.length()<4){status.setText("Informe ao menos o nome da rua.");return;}
        final String q=raw;
        status.setText("Procurando endereços com esse nome em todo o Brasil…");
        exec.execute(()->{
            try{
                String path="/api/public-router/geocode?all=1&q="+URLEncoder.encode(q,"UTF-8");
                JSONObject j=Api.get(path);
                JSONArray rows=j.optJSONArray("rows");
                if(rows==null||rows.length()==0)throw new Exception("Endereço não encontrado.");
                final JSONArray found=new JSONArray(rows.toString());
                runOnUiThread(()->showAddressChoices(q,found,reopenVoice));
            }catch(Exception e){
                runOnUiThread(()->{
                    status.setText("Erro: "+e.getMessage());
                    if(reopenVoice)new Handler(Looper.getMainLooper()).postDelayed(()->voice(),900);
                });
            }
        });
    }

    private void showAddressChoices(String original,JSONArray rows,boolean reopenVoice){
        final ArrayList<JSONObject> choices=new ArrayList<>();
        final ArrayList<String> labels=new ArrayList<>();

        for(int i=0;i<rows.length();i++){
            JSONObject p=rows.optJSONObject(i);
            if(p==null)continue;
            choices.add(p);
            String road=p.optString("road","");
            String city=p.optString("city","");
            String state=p.optString("state","");
            String full=p.optString("label",original);
            String title=!road.isEmpty()?road:full;
            String where="";
            if(!city.isEmpty())where=city;
            if(!state.isEmpty())where+=(where.isEmpty()?"":" • ")+state;
            labels.add(where.isEmpty()?title:(title+"\n"+where));
        }

        if(choices.isEmpty()){
            status.setText("Nenhum endereço encontrado.");
            if(reopenVoice)new Handler(Looper.getMainLooper()).postDelayed(()->voice(),900);
            return;
        }

        new AlertDialog.Builder(this)
            .setTitle("Qual endereço você deseja?")
            .setItems(labels.toArray(new String[0]),(d,which)->{
                if(which<0||which>=choices.size())return;
                try{
                    JSONObject p=choices.get(which);
                    JSONObject s=new JSONObject();
                    String confirmed=p.optString("label",original);
                    s.put("lat",p.getDouble("lat"));
                    s.put("lon",p.getDouble("lon"));
                    s.put("original",original);
                    s.put("label",confirmed);
                    s.put("resolved",confirmed);
                    s.put("approximate",p.optBoolean("approximate",false));
                    s.put("precision",p.optString("precision",""));
                    stops.add(s);
                    if(start==null)start=new JSONObject(s.toString());
                    address.setText("");
                    lastPlan=null;
                    refreshStartPointUi();
                    renderList();
                    renderMap(null);
                    status.setText("Entrega "+stops.size()+" adicionada. Fale a próxima. Quando terminar, toque em Otimizar rota.");
                    if(reopenVoice)new Handler(Looper.getMainLooper()).postDelayed(()->voice(),650);
                }catch(Exception e){
                    status.setText("Não foi possível adicionar esse endereço.");
                }
            })
            .setNegativeButton("Cancelar",(d,w)->{
                status.setText("Seleção cancelada.");
                if(reopenVoice)new Handler(Looper.getMainLooper()).postDelayed(()->voice(),650);
            })
            .show();
    }

    private void optimize(){
        if(stops.size()<2){status.setText("Adicione pelo menos duas paradas para otimizar.");return;}
        if(optimizeButton!=null){
            optimizeButton.setEnabled(false);
            optimizeButton.setText("Otimizando…");
            optimizeButton.setAlpha(.65f);
        }
        status.setText("Calculando a melhor sequência pelas vias reais…");
        exec.execute(()->{
            try{
                JSONObject body=new JSONObject();JSONArray arr=new JSONArray();
                boolean returnToStart=prefs.getBoolean("current_return_start",true);
                JSONObject effectiveStart=start;

                if(effectiveStart==null&&!stops.isEmpty()){
                    effectiveStart=new JSONObject(stops.get(0).toString());
                    start=new JSONObject(effectiveStart.toString());
                }
                if(effectiveStart==null)throw new Exception("Defina o ponto de partida.");

                double slat=effectiveStart.optDouble("lat",Double.NaN),slon=effectiveStart.optDouble("lon",Double.NaN);
                // Rota que veio da empresa: a saída é a base, que NÃO é uma entrega. Ela só fica na
                // lista quando o próprio usuário a colocou como primeira parada (rota livre).
                boolean startInStops=false;
                for(JSONObject s:stops){
                    double lat=s.optDouble("lat",Double.NaN),lon=s.optDouble("lon",Double.NaN);
                    boolean sameStart=Double.isFinite(slat)&&Double.isFinite(slon)&&Double.isFinite(lat)&&Double.isFinite(lon)
                        &&Math.abs(lat-slat)<0.000001&&Math.abs(lon-slon)<0.000001;
                    if(sameStart)startInStops=true;
                    else arr.put(new JSONObject(s.toString()));
                }
                if(arr.length()<1)throw new Exception("Adicione pelo menos uma parada além do ponto de partida.");
                body.put("stops",arr);
                body.put("start",effectiveStart);
                body.put("returnToStart",returnToStart);
                body.put("avoidTolls",avoidedTolls());
                JSONObject j=Api.post("/api/public-router/optimize",body);
                if(!j.optBoolean("ok",false))throw new Exception(j.optString("error","Falha ao otimizar rota."));
                lastPlan=j;
                JSONArray order=j.getJSONArray("order");
                ArrayList<JSONObject> ordered=new ArrayList<>();
                JSONArray points=j.getJSONArray("points");
                boolean roundTrip=j.optBoolean("returnToStart",prefs.getBoolean("current_return_start",true));
                if(points.length()>0){
                    JSONObject startPoint=new JSONObject(points.getJSONObject(0).toString());
                    start=new JSONObject(startPoint.toString());
                    if(startInStops)ordered.add(startPoint);
                }
                for(int i=0;i<order.length();i++){
                    int idx=order.getInt(i);
                    if(idx>=0&&idx<points.length())ordered.add(points.getJSONObject(idx));
                }
                if(ordered.isEmpty())throw new Exception("O servidor não retornou uma sequência válida.");
                stops.clear();stops.addAll(ordered);
                runOnUiThread(()->{
                    int[] mins={10,15,20,30,45,60};
                    int stopMin=mins[Math.min(mins.length-1,Math.max(0,prefs.getInt("cfg_time",2)))];
                    double totalSec=j.optDouble("durationSeconds",0)+(stops.size()*stopMin*60d);
                    summary.setText(fmtTime(totalSec)+" • "+stops.size()+" pontos • "+fmtKm(j.optDouble("distanceMeters",0))+(prefs.getBoolean("current_return_start",false)?" • retorna ao início":" • só ida"));
                    int avoidRequested=j.optInt("avoidanceRequested",0),avoidHits=j.optInt("avoidanceHits",0);
                    if(avoidRequested>0&&avoidHits==0)status.setText("Rota reotimizada evitando "+avoidRequested+" pedágio(s) selecionado(s).");
                    else if(avoidRequested>0)status.setText("Rota reotimizada, mas "+avoidHits+" pedágio(s) selecionado(s) ainda não têm desvio viável encontrado.");
                    else status.setText("Rota otimizada com sucesso.");
                    renderList();renderMap(j);
                    if(isTruckVehicle())analyzeTruckRestrictions(false);
                    showTolls(false);
                    if(optimizeButton!=null){optimizeButton.setEnabled(true);optimizeButton.setText("Otimizar rota");optimizeButton.setAlpha(1f);}
                });
            }catch(Exception e){
                runOnUiThread(()->{
                    status.setText("Não foi possível otimizar: "+e.getMessage());
                    if(optimizeButton!=null){optimizeButton.setEnabled(true);optimizeButton.setText("Tentar novamente");optimizeButton.setAlpha(1f);}
                });
            }
        });
    }

    private String fmtKm(double m){return String.format(Locale.forLanguageTag("pt-BR"),"%.1f km",m/1000d);}
    private String fmtTime(double sec){long min=Math.round(sec/60d);return min>=60?(min/60+"h "+min%60+"min"):(min+" min");}

    private void renderList(){
        final int NAVY=Color.rgb(22,20,47),GREEN=Color.rgb(99,202,67),BLUE=Color.rgb(47,115,232),TEXT=Color.rgb(30,41,59),MUTED=Color.rgb(100,116,139),LINE=Color.rgb(226,232,240);
        list.removeAllViews();
        persistState();
        final boolean day=dayMode();
        if(day)daySummary();
        else if(lastPlan==null)summary.setText(stops.size()+" parada"+(stops.size()==1?"":"s"));
        if(stops.isEmpty()){
            TextView empty=label(day?"As entregas do seu romaneio de hoje aparecem aqui.":"Nenhuma parada adicionada ainda.",13,MUTED,false);empty.setGravity(Gravity.CENTER);empty.setPadding(dp(8),dp(18),dp(8),dp(18));list.addView(empty);return;
        }
        for(int i=0;i<stops.size();i++){
            final int idx=i;JSONObject s=stops.get(i);
            LinearLayout row=new LinearLayout(this);row.setOrientation(LinearLayout.VERTICAL);row.setPadding(dp(10),dp(10),dp(8),dp(10));row.setBackground(strokedBg(Color.rgb(250,252,254),LINE,14));
            if(i>0){LinearLayout.LayoutParams rp=new LinearLayout.LayoutParams(-1,-2);rp.setMargins(0,dp(8),0,0);row.setLayoutParams(rp);}

            LinearLayout top=new LinearLayout(this);top.setOrientation(LinearLayout.HORIZONTAL);top.setGravity(Gravity.CENTER_VERTICAL);
            final boolean delivered=day&&s.optBoolean("entregue",false);
            TextView num=label(delivered?"✓":String.valueOf(i+1),14,delivered?Color.WHITE:NAVY,true);num.setGravity(Gravity.CENTER);num.setBackground(bg(delivered?Color.rgb(148,163,184):GREEN,50));top.addView(num,new LinearLayout.LayoutParams(dp(36),dp(36)));
            if(delivered)row.setAlpha(.62f);

            LinearLayout info=new LinearLayout(this);info.setOrientation(LinearLayout.VERTICAL);info.setPadding(dp(10),0,dp(6),0);
            String confirmed=s.optString("resolved",s.optString("label","Parada"));
            String original=s.optString("original","");
            if(day){
                // Rota do dia: cliente em destaque, depois endereço, nota e situação.
                TextView who=label(s.optString("label","Entrega "+(i+1)),15,TEXT,true);who.setMaxLines(2);info.addView(who);
                if(!confirmed.isEmpty()&&!confirmed.equalsIgnoreCase(s.optString("label",""))){
                    TextView ad=label(confirmed,13,MUTED,false);ad.setMaxLines(3);ad.setPadding(0,dp(2),0,0);info.addView(ad);
                }
                if(s.optBoolean("approximate",false)&&original.isEmpty()){
                    TextView ap=label("Sem endereço no romaneio: posição aproximada (cidade)",11,Color.rgb(185,93,0),true);ap.setPadding(0,dp(2),0,0);info.addView(ap);
                }
                String nf=s.optString("nf",""),extra=nf.isEmpty()?"":"NF "+nf;
                if(delivered)extra=(extra.isEmpty()?"":extra+" • ")+"Entregue"+(s.optString("baixaAt","").isEmpty()?"":" "+s.optString("baixaAt",""));
                if(!extra.isEmpty()){
                    TextView ex=label(extra,12,delivered?Color.rgb(21,128,61):MUTED,true);ex.setPadding(0,dp(3),0,0);info.addView(ex);
                }
            }else{
            TextView t=label(confirmed,14,TEXT,true);t.setMaxLines(3);
            info.addView(t);
            }
            if(!day&&s.optBoolean("approximate",false)){
                TextView approx=label("Localização aproximada da rua/CEP",11,Color.rgb(185,93,0),true);
                approx.setPadding(0,dp(2),0,0);info.addView(approx);
            }
            if(!day&&!original.isEmpty()&&!original.equalsIgnoreCase(confirmed)){
                TextView r=label("Digitado: "+original,11,MUTED,false);r.setMaxLines(2);r.setPadding(0,dp(2),0,0);info.addView(r);
            }
            top.addView(info,new LinearLayout.LayoutParams(0,-2,1));

            Button up=pill("↑",Color.rgb(238,242,247),NAVY);up.setTextSize(17);up.setEnabled(idx>0);up.setAlpha(idx>0?1f:.35f);
            up.setOnClickListener(v->{if(idx>0){Collections.swap(stops,idx,idx-1);lastPlan=null;renderList();renderMap(null);}});
            Button del=pill("×",Color.rgb(255,241,242),Color.rgb(190,24,93));del.setTextSize(20);
            del.setOnClickListener(v->{
                JSONObject removed=stops.remove(idx);
                if(start!=null&&Math.abs(start.optDouble("lat",999)-removed.optDouble("lat",-999))<0.000001&&Math.abs(start.optDouble("lon",999)-removed.optDouble("lon",-999))<0.000001){
                    start=stops.isEmpty()?null:stops.get(0);
                }
                lastPlan=null;refreshStartPointUi();renderList();renderMap(null);status.setText("Parada removida.");
            });
            // Na rota do dia a ordem e as paradas vêm da empresa: não há mover nem excluir.
            LinearLayout.LayoutParams bp=new LinearLayout.LayoutParams(dp(42),dp(42));bp.setMargins(dp(4),0,0,0);if(!day)top.addView(up,bp);
            LinearLayout.LayoutParams bp2=new LinearLayout.LayoutParams(dp(42),dp(42));bp2.setMargins(dp(4),0,0,0);if(!day)top.addView(del,bp2);
            row.addView(top);

            LinearLayout navRow=new LinearLayout(this);navRow.setOrientation(LinearLayout.HORIZONTAL);navRow.setPadding(dp(46),dp(8),0,0);
            Button maps=pill("Google Maps",Color.WHITE,BLUE);maps.setBackground(strokedBg(Color.WHITE,LINE,12));maps.setOnClickListener(v->openStopInMaps(stops.get(idx)));
            Button waze=pill("Waze",Color.WHITE,BLUE);waze.setBackground(strokedBg(Color.WHITE,LINE,12));waze.setOnClickListener(v->openStopInWaze(stops.get(idx)));
            navRow.addView(maps,new LinearLayout.LayoutParams(0,dp(44),1));
            LinearLayout.LayoutParams wp=new LinearLayout.LayoutParams(0,dp(44),.8f);wp.setMargins(dp(8),0,0,0);navRow.addView(waze,wp);
            row.addView(navRow);

            list.addView(row);
        }
    }

    private String stopCoords(JSONObject s){
        return s.optDouble("lat")+","+s.optDouble("lon");
    }

    private String navigationTarget(JSONObject s){
        // Se nossa geocodificação ficou apenas aproximada, deixe o próprio app
        // de navegação resolver o endereço digitado pelo usuário. Isso evita
        // enviar uma coordenada aproximada como se fosse o número exato.
        if(s.optBoolean("approximate",false)){
            String original=s.optString("original","").trim();
            if(!original.isEmpty())return original;
        }
        return stopCoords(s);
    }

    private void openStopInMaps(JSONObject s){
        String d=navigationTarget(s);
        try{
            Intent i=new Intent(Intent.ACTION_VIEW,Uri.parse("google.navigation:q="+Uri.encode(d)+"&mode=d"));
            i.setPackage("com.google.android.apps.maps");
            startActivity(i);
        }catch(Exception e){
            startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://www.google.com/maps/dir/?api=1&destination="+Uri.encode(d)+"&travelmode=driving")));
        }
    }

    private void openStopInWaze(JSONObject s){
        String d=navigationTarget(s);
        try{
            String url=s.optBoolean("approximate",false)
                ?"https://waze.com/ul?q="+Uri.encode(d)+"&navigate=yes"
                :"https://waze.com/ul?ll="+Uri.encode(d)+"&navigate=yes";
            startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));
        }catch(Exception e){
            status.setText("Não foi possível abrir o Waze.");
        }
    }

    private void navigateFirst(){
        if(stops.isEmpty()){status.setText(dayMode()?"Ainda não há entregas para hoje.":"Nenhuma parada.");return;}
        JSONObject next=stops.get(0);
        if(dayMode()){
            next=null;
            for(JSONObject x:stops)if(!x.optBoolean("entregue",false)){next=x;break;}
            if(next==null){status.setText("Todas as entregas de hoje já constam como entregues.");return;}
        }
        final JSONObject s=next;
        new AlertDialog.Builder(this)
            .setTitle(dayMode()?"Navegar até "+s.optString("label","a próxima entrega"):"Abrir próxima parada")
            .setItems(new String[]{"Google Maps","Waze"},(d,which)->{
                if(which==0)openStopInMaps(s);else openStopInWaze(s);
            })
            .setNegativeButton("Cancelar",null)
            .show();
    }

    private void renderMap(JSONObject plan){
        String points="[]",labels="[]",geometry="null",returnPoint="null",returnLabel="";
        try{
            JSONArray a=new JSONArray(),labs=new JSONArray();
            for(JSONObject s:stops){
                JSONArray p=new JSONArray();p.put(s.getDouble("lat"));p.put(s.getDouble("lon"));a.put(p);
                labs.put(s.optString("resolved",s.optString("label","Parada")));
            }
            points=a.toString();labels=labs.toString();
            if(plan!=null&&plan.optJSONObject("geometry")!=null)geometry=plan.getJSONObject("geometry").toString();

            if(prefs.getBoolean("current_return_start",false)){
                JSONObject rp=start;
                if(rp==null&&!stops.isEmpty())rp=stops.get(0);
                if(rp!=null){
                    JSONArray x=new JSONArray();x.put(rp.getDouble("lat"));x.put(rp.getDouble("lon"));
                    returnPoint=x.toString();
                    returnLabel=rp.optString("resolved",rp.optString("label","Ponto de início"));
                }
            }
        }catch(Exception ignored){}

        String safeReturn=JSONObject.quote(returnLabel);
        String html="<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"+
        "<link rel='stylesheet' href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'><style>html,body,#m{height:100%;margin:0}.returnTag{background:#16142f;color:#fff;border:3px solid #fff;border-radius:18px;min-width:38px;height:34px;display:flex;align-items:center;justify-content:center;padding:0 8px;font:bold 12px sans-serif;box-shadow:0 2px 7px #0005;white-space:nowrap}</style></head><body><div id='m'></div>"+
        "<script src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'></script><script>var m=L.map('m').setView([-22.8,-47.2],9);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(m);"+
        "var pts="+points+",labs="+labels+";pts.forEach((p,i)=>{var n=i+1;var ic=L.divIcon({className:'',html:'<div style=\"width:34px;height:34px;border-radius:50%;background:#2f73e8;color:white;border:3px solid white;box-shadow:0 2px 7px #0005;display:flex;align-items:center;justify-content:center;font:bold 15px sans-serif\">'+n+'</div>',iconSize:[34,34],iconAnchor:[17,17]});L.marker(p,{icon:ic}).addTo(m).bindPopup('<b>Parada '+n+'</b><br>'+(labs[i]||'' )).bindTooltip('Parada '+n,{direction:'top'});});"+
        "var ret="+returnPoint+",retLabel="+safeReturn+";if(ret){var ric=L.divIcon({className:'',html:'<div class=\"returnTag\">↩ RETORNO</div>',iconSize:[86,34],iconAnchor:[43,-6]});L.marker(ret,{icon:ric,zIndexOffset:1000}).addTo(m).bindPopup('<b>Retorno ao ponto de início</b><br>'+retLabel).bindTooltip('Retorno ao início',{direction:'top'});}"+
        "var g="+geometry+";if(g&&g.coordinates){var ll=g.coordinates.map(x=>[x[1],x[0]]);L.polyline(ll,{weight:6,color:'#5fca43',opacity:.92,lineCap:'round',lineJoin:'round'}).addTo(m);if(ll.length)m.fitBounds(ll,{padding:[28,28]});}else if(pts.length)m.fitBounds(pts,{padding:[36,36]});</script></body></html>";
        map.loadDataWithBaseURL("https://app.local/",html,"text/html","UTF-8",null);
    }

    private String token(){return prefs.getString("token","");}
    private String userName(){return prefs.getString("name","");}
    private String userPlan(){return prefs.getString("plan","free");}

    private void refreshAccount(){
        if(account!=null)account.setText(BuildConfig.PLAY_STORE_BUILD?"MOVIT":"Modo teste");
        if(cloudSave!=null)cloudSave.setEnabled(true);
        if(cloudRoutes!=null)cloudRoutes.setEnabled(true);
    }

    private void accountDialog(){
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(30,12,30,0);
        EditText name=new EditText(this);name.setHint("Nome (para criar conta)");
        EditText email=new EditText(this);email.setHint("E-mail");email.setInputType(android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        EditText pass=new EditText(this);pass.setHint("Senha");pass.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        box.addView(name);box.addView(email);box.addView(pass);
        AlertDialog d=new AlertDialog.Builder(this).setTitle(token().isEmpty()?"Entrar ou criar conta":"Minha conta").setView(box)
            .setNegativeButton("Cancelar",null)
            .setNeutralButton(token().isEmpty()?"Criar conta":"Sair",null)
            .setPositiveButton(token().isEmpty()?"Entrar":"OK",null).create();
        d.setOnShowListener(x->{
            if(token().isEmpty()){
                d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->auth(email.getText().toString(),pass.getText().toString(),"",false,d));
                d.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v->auth(email.getText().toString(),pass.getText().toString(),name.getText().toString(),true,d));
            }else{
                name.setVisibility(View.GONE);email.setVisibility(View.GONE);pass.setVisibility(View.GONE);
                TextView info=new TextView(this);info.setText("Logado como "+userName()+"\nPlano: "+userPlan());info.setPadding(8,18,8,18);box.addView(info);
                d.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v->{prefs.edit().clear().apply();d.dismiss();refreshAccount();});
            }
        });
        d.show();
    }

    private void auth(String email,String password,String name,boolean register,AlertDialog dialog){
        email=email.trim().toLowerCase();name=name.trim();
        if(email.isEmpty()||password.length()<6){status.setText("Informe e-mail e senha com pelo menos 6 caracteres.");return;}
        status.setText(register?"Criando conta…":"Entrando…");
        final String e=email,p=password,n=name;
        exec.execute(()->{
            try{
                JSONObject b=new JSONObject();b.put("email",e);b.put("password",p);if(register)b.put("name",n);
                JSONObject j=Api.post(register?"/api/router-app/register":"/api/router-app/login",b);
                JSONObject u=j.getJSONObject("user");
                prefs.edit().putString("token",j.getString("token")).putString("name",u.optString("name","Usuário")).putString("plan",u.optString("plan","free")).apply();
                runOnUiThread(()->{dialog.dismiss();status.setText(register?"Conta criada. Suas rotas agora podem ser salvas na nuvem.":"Login realizado.");refreshAccount();});
            }catch(Exception ex){runOnUiThread(()->status.setText("Conta: "+ex.getMessage()));}
        });
    }

    private JSONObject currentRouteData()throws Exception{
        JSONObject data=new JSONObject();JSONArray arr=new JSONArray();
        for(JSONObject s:stops)arr.put(new JSONObject(s.toString()));
        data.put("stops",arr);if(start!=null)data.put("start",new JSONObject(start.toString()));
        data.put("returnToStart",prefs.getBoolean("current_return_start",false));
        data.put("driverName",prefs.getString("current_driver_name",""));
        data.put("romaneio",prefs.getString("current_romaneio",""));
        data.put("eventDate",prefs.getString("current_event_date",""));
        data.put("vehicle",vehicleProfile());
        if(lastPlan!=null){
            data.put("distanceMeters",lastPlan.optDouble("distanceMeters",0));
            data.put("durationSeconds",lastPlan.optDouble("durationSeconds",0));
            if(lastPlan.optJSONObject("geometry")!=null)data.put("geometry",lastPlan.optJSONObject("geometry"));
            if(lastPlan.optJSONArray("order")!=null)data.put("order",lastPlan.optJSONArray("order"));
        }
        return data;
    }

    private void saveCloud(){
        if(stops.isEmpty()){status.setText("Adicione uma rota antes de salvar.");return;}
        final EditText input=new EditText(this);input.setHint("Nome da rota");input.setText("Rota "+new java.text.SimpleDateFormat("dd/MM/yyyy",Locale.getDefault()).format(new Date()));
        new AlertDialog.Builder(this).setTitle("Salvar rota no aparelho").setView(input).setNegativeButton("Cancelar",null).setPositiveButton("Salvar",(d,w)->{
            try{
                String name=input.getText().toString().trim();
                if(name.isEmpty())name="Minha rota";
                JSONArray saved=new JSONArray(prefs.getString("local_routes","[]"));
                JSONObject row=new JSONObject();
                row.put("id",System.currentTimeMillis());
                row.put("name",name);
                row.put("updated_at",new java.text.SimpleDateFormat("dd/MM/yyyy HH:mm",Locale.getDefault()).format(new Date()));
                row.put("route_data",currentRouteData());
                JSONArray next=new JSONArray();next.put(row);
                for(int i=0;i<saved.length()&&i<29;i++)next.put(saved.get(i));
                prefs.edit().putString("local_routes",next.toString()).apply();
                status.setText("Rota salva neste aparelho.");
            }catch(Exception e){status.setText("Salvar: "+e.getMessage());}
        }).show();
    }

    private void loadCloudRoutes(){
        try{
            JSONArray rows=new JSONArray(prefs.getString("local_routes","[]"));
            if(rows.length()==0){status.setText("Você ainda não tem rotas salvas neste aparelho.");return;}
            final String[] names=new String[rows.length()];
            final JSONObject[] items=new JSONObject[rows.length()];
            for(int i=0;i<rows.length();i++){
                items[i]=rows.getJSONObject(i);
                names[i]=items[i].optString("name","Rota")+" • "+items[i].optString("updated_at","");
            }
            new AlertDialog.Builder(this).setTitle("Rotas salvas").setItems(names,(d,which)->openCloudRoute(items[which])).setNegativeButton("Fechar",null).show();
        }catch(Exception e){status.setText("Rotas: "+e.getMessage());}
    }

    private void openCloudRoute(JSONObject row){
        try{
            JSONObject data=row.optJSONObject("route_data");if(data==null)return;
            JSONArray arr=data.optJSONArray("stops");stops.clear();
            if(arr!=null)for(int i=0;i<arr.length();i++)stops.add(arr.getJSONObject(i));
            start=data.optJSONObject("start");lastPlan=null;
            status.setText("Rota “"+row.optString("name","") +"” aberta. Toque em Otimizar para atualizar o trajeto.");
            renderList();renderMap(null);
        }catch(Exception e){status.setText("Não foi possível abrir a rota.");}
    }


    @Override protected void onDestroy(){
        try{if(testLocationManager!=null&&testLocationListener!=null)testLocationManager.removeUpdates(testLocationListener);}catch(Exception ignored){}
        exec.shutdownNow();
        super.onDestroy();
    }
}
