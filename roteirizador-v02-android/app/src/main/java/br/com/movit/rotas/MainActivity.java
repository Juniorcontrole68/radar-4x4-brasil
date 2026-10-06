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
    private static final int REQ_VOICE=10,REQ_LOC=11,REQ_TEST_LOC=12;
    private final ArrayList<JSONObject> stops=new ArrayList<>();
    private final ExecutorService exec=Executors.newSingleThreadExecutor();
    private LinearLayout list;
    private EditText address;
    private TextView status,summary;
    private WebView map;
    private JSONObject start=null,lastPlan=null;
    private android.content.SharedPreferences prefs;
    private TextView account,routeTitle,startPointLabel;
    private Button cloudSave,cloudRoutes,optimizeButton,testTrackingButton;
    private Switch returnStartHome;
    private LocationManager testLocationManager;
    private LocationListener testLocationListener;
    private String testTrackingToken="";
    private boolean testTrackingActive=false;

    @Override public void onCreate(Bundle b){
        super.onCreate(b);
        prefs=getSharedPreferences("rv2_account",MODE_PRIVATE);
        if(!prefs.contains("current_return_start"))prefs.edit().putBoolean("current_return_start",true).apply();
        buildUi();renderList();renderMap(null);refreshAccount();refreshStartPointUi();handleSharedRouteIntent(getIntent());
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

        ScrollView outer=new ScrollView(this);outer.setFillViewport(true);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(12),0,dp(12),dp(18));
        outer.addView(root,new ScrollView.LayoutParams(-1,-2));page.addView(outer,new LinearLayout.LayoutParams(-1,0,1));

        // Mapa grande
        LinearLayout mapCard=card(0);mapCard.setClipToOutline(true);
        map=new WebView(this);map.getSettings().setJavaScriptEnabled(true);map.setBackgroundColor(Color.WHITE);
        mapCard.addView(map,new LinearLayout.LayoutParams(-1,dp(360)));
        root.addView(mapCard);
        gap(root,8);

        // Busca estilo barra inferior do mapa
        LinearLayout searchRow=new LinearLayout(this);searchRow.setOrientation(LinearLayout.HORIZONTAL);searchRow.setGravity(Gravity.CENTER_VERTICAL);
        address=new EditText(this);address.setHint("Adicione ou busque uma parada");address.setSingleLine(true);address.setTextSize(15);address.setTextColor(TEXT);address.setHintTextColor(Color.rgb(139,151,176));address.setBackground(strokedBg(Color.WHITE,LINE,16));address.setPadding(dp(14),0,dp(10),0);
        searchRow.addView(address,new LinearLayout.LayoutParams(0,dp(52),1));
        Button voice=pill("Falar",Color.WHITE,BLUE);voice.setTextSize(13);voice.setPadding(0,0,0,0);voice.setOnClickListener(v->voice());
        LinearLayout.LayoutParams vp=new LinearLayout.LayoutParams(dp(78),dp(50));vp.setMargins(dp(8),0,0,0);searchRow.addView(voice,vp);
        Button add=pill("Adicionar",BLUE,Color.WHITE);add.setTextSize(13);add.setOnClickListener(v->addAddress(address.getText().toString()));
        LinearLayout.LayoutParams ap=new LinearLayout.LayoutParams(dp(96),dp(50));ap.setMargins(dp(6),0,0,0);searchRow.addView(add,ap);
        root.addView(searchRow);

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
        gap(info,8);

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

        testTrackingButton=pill("🧪 Testar no mapa CONSTRULOG",Color.rgb(255,247,237),Color.rgb(154,52,18));
        testTrackingButton.setBackground(strokedBg(Color.rgb(255,247,237),Color.rgb(253,186,116),14));
        testTrackingButton.setOnClickListener(v->{if(testTrackingActive)stopConstrulogTest();else startConstrulogTest();});
        LinearLayout.LayoutParams testLp=new LinearLayout.LayoutParams(-1,dp(48));testLp.setMargins(0,0,0,dp(8));info.addView(testTrackingButton,testLp);

        LinearLayout shareRow=new LinearLayout(this);shareRow.setOrientation(LinearLayout.HORIZONTAL);
        Button share=pill("↗  Compartilhar rota",Color.WHITE,BLUE);share.setBackground(strokedBg(Color.WHITE,LINE,14));share.setOnClickListener(v->shareRoute());
        Button save=pill("Salvar",Color.WHITE,NAVY);save.setBackground(strokedBg(Color.WHITE,LINE,14));save.setOnClickListener(v->saveCloud());
        shareRow.addView(share,new LinearLayout.LayoutParams(0,dp(48),1));
        LinearLayout.LayoutParams svp=new LinearLayout.LayoutParams(dp(96),dp(48));svp.setMargins(dp(8),0,0,0);shareRow.addView(save,svp);
        info.addView(shareRow);
        root.addView(info);

        gap(root,10);

        // Paradas
        LinearLayout stopsCard=card(12);
        LinearLayout stHead=new LinearLayout(this);stHead.setOrientation(LinearLayout.HORIZONTAL);stHead.setGravity(Gravity.CENTER_VERTICAL);
        TextView stopsTitle=label("Paradas",17,TEXT,true);stHead.addView(stopsTitle,new LinearLayout.LayoutParams(0,-2,1));
        Button edit=pill("Editar",Color.WHITE,BLUE);edit.setBackground(strokedBg(Color.WHITE,LINE,12));edit.setOnClickListener(v->status.setText("Use ↑ para mover e × para excluir uma parada."));
        stHead.addView(edit,new LinearLayout.LayoutParams(dp(82),dp(42)));stopsCard.addView(stHead);
        list=new LinearLayout(this);list.setOrientation(LinearLayout.VERTICAL);list.setPadding(0,dp(6),0,0);stopsCard.addView(list,new LinearLayout.LayoutParams(-1,-2));
        root.addView(stopsCard);

        gap(root,10);

        // Barra inferior de ação
        LinearLayout bottom=card(10);bottom.setOrientation(LinearLayout.HORIZONTAL);bottom.setGravity(Gravity.CENTER_VERTICAL);
        optimizeButton=pill("Otimizar rota",Color.WHITE,NAVY);optimizeButton.setTextSize(14);optimizeButton.setBackground(strokedBg(Color.WHITE,LINE,14));optimizeButton.setOnClickListener(v->optimize());
        Button startBtn=pill("Iniciar rota",BLUE,Color.WHITE);startBtn.setTextSize(14);startBtn.setOnClickListener(v->{if(lastPlan==null)optimize();else navigateFirst();});
        bottom.addView(optimizeButton,new LinearLayout.LayoutParams(0,dp(56),1f));
        LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(0,dp(56),1f);sp.setMargins(dp(10),0,0,0);bottom.addView(startBtn,sp);
        root.addView(bottom);

        // objetos mantidos para compatibilidade
        account=label("Modo teste",11,MUTED,false);
        cloudSave=save;cloudRoutes=edit;

        setContentView(page);
    }

    private void showMainMenu(){
        final int NAVY=Color.rgb(22,20,47),BLUE=Color.rgb(47,115,232),TEXT=Color.rgb(22,27,45),MUTED=Color.rgb(91,105,135),LINE=Color.rgb(225,231,241);
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(dp(18),dp(10),dp(18),dp(14));
        TextView title=label("MOVIT",24,NAVY,true);box.addView(title);
        TextView test=label("Modo de teste • sem cadastro",12,MUTED,false);test.setPadding(0,0,0,dp(14));box.addView(test);

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

        TextView nlab=label("Nome do motorista",13,MUTED,false);nlab.setPadding(0,dp(16),0,dp(4));box.addView(nlab);
        EditText driver=new EditText(this);driver.setHint("Ex.: Júlio");driver.setText(prefs.getString("current_driver_name",""));box.addView(driver);

        TextView rlab=label("Número do romaneio CONSTRULOG",13,MUTED,false);rlab.setPadding(0,dp(12),0,dp(4));box.addView(rlab);
        EditText romaneio=new EditText(this);romaneio.setHint("Ex.: TBT12345");romaneio.setText(prefs.getString("current_romaneio",""));romaneio.setSingleLine(true);box.addView(romaneio);

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
            if(driverName.isEmpty()){status.setText("Informe o nome do motorista.");return;}
            if(romaneioNumber.isEmpty()){status.setText("Informe o número do romaneio CONSTRULOG.");return;}
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
        String[] vehicles={"Carro","Caminhão pequeno","Van","Moto"};
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

        Switch toll=new Switch(this);toll.setText("Evitar pedágios");toll.setChecked(prefs.getBoolean("cfg_toll",false));box.addView(toll);
        Switch returnStart=new Switch(this);returnStart.setText("Retornar ao ponto de saída");returnStart.setChecked(prefs.getBoolean("current_return_start",false));box.addView(returnStart);
        addSetting(box,"ID de parada",idsSp,MUTED,TEXT);
        Switch bubble=new Switch(this);bubble.setText("Balão do modo de navegação");bubble.setChecked(prefs.getBoolean("cfg_bubble",true));box.addView(bubble);

        new AlertDialog.Builder(this).setView(box).setNegativeButton("Cancelar",null).setPositiveButton("Salvar",(d,w)->{
            prefs.edit().putInt("cfg_nav",nav.getSelectedItemPosition()).putInt("cfg_side",side.getSelectedItemPosition()).putInt("cfg_time",tm.getSelectedItemPosition()).putInt("cfg_vehicle",veh.getSelectedItemPosition()).putInt("cfg_ids",idsSp.getSelectedItemPosition()).putBoolean("cfg_toll",toll.isChecked()).putBoolean("current_return_start",returnStart.isChecked()).putBoolean("cfg_bubble",bubble.isChecked()).apply();
            if(returnStartHome!=null)returnStartHome.setChecked(returnStart.isChecked());
            status.setText("Configurações salvas.");
        }).show();
    }

    private void addSetting(LinearLayout box,String title,View control,int muted,int text){
        TextView t=label(title,14,text,true);t.setPadding(0,dp(14),0,0);box.addView(t);box.addView(control);
    }

    private void shareRoute(){
        if(stops.isEmpty()){status.setText("Adicione paradas antes de compartilhar.");return;}
        final String driver=prefs.getString("current_driver_name","Motorista");
        final String romaneio=prefs.getString("current_romaneio","");
        final String eventDateIso=prefs.getString("current_event_date",new java.text.SimpleDateFormat("yyyy-MM-dd",Locale.getDefault()).format(new Date()));
        if(romaneio.trim().isEmpty()){status.setText("Associe um romaneio CONSTRULOG antes de exportar.");return;}
        String dateBr=eventDateIso;
        try{
            Date parsed=new java.text.SimpleDateFormat("yyyy-MM-dd",Locale.getDefault()).parse(eventDateIso);
            if(parsed!=null)dateBr=new java.text.SimpleDateFormat("dd/MM/yyyy",Locale.getDefault()).format(parsed);
        }catch(Exception ignored){}
        final String eventDateBr=dateBr;
        final String title=driver+" "+eventDateBr;
        status.setText("Exportando rota para a CONSTRULOG…");
        exec.execute(()->{
            try{
                JSONObject exportBody=new JSONObject();
                exportBody.put("romaneio",romaneio);
                exportBody.put("driver_name",driver);
                exportBody.put("event_date",eventDateIso);
                exportBody.put("title",title);
                exportBody.put("route_data",currentRouteData());
                JSONObject exported=Api.post("/api/public-router/export-construlog",exportBody);
                if(!exported.optBoolean("ok",false))throw new Exception(exported.optString("error","Falha ao enviar rota à CONSTRULOG."));

                JSONObject body=new JSONObject();
                body.put("driver_name",driver);
                body.put("event_date",eventDateIso);
                body.put("title",title);
                body.put("route_data",currentRouteData());
                JSONObject j=Api.post("/api/public-router/share",body);
                final String link=j.getString("shareUrl");
                final String msg="Rota MOVIT - "+driver+" - "+eventDateBr+" - Romaneio "+romaneio+"\n"+link;
                final boolean linked=exported.optBoolean("linked_to_tracking",false);
                runOnUiThread(()->{
                    showShareOptions(title,msg,link);
                    status.setText(linked?"Rota exportada e associada ao rastreamento CONSTRULOG.":"Rota exportada para a CONSTRULOG e pronta para compartilhar.");
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
        if(!"movit".equalsIgnoreCase(data.getScheme())||!"route".equalsIgnoreCase(data.getHost()))return;
        String token=data.getLastPathSegment();
        if(token==null||token.length()<10)return;
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
                    renderList();
                    renderMap(null);
                    status.setText("Rota compartilhada aberta. Toque em Otimizar para atualizar o trajeto.");
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
            if(out!=null&&!out.isEmpty()){address.setText(out.get(0));status.setText("Endereço reconhecido. Toque em + Parada.");}
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
    }

    private void addAddress(String raw){
        raw=raw.trim();if(raw.length()<5){status.setText("Informe um endereço mais completo.");return;}
        final String q=raw;status.setText("Localizando endereço…");
        exec.execute(()->{
            try{
                JSONObject j=Api.get("/api/public-router/geocode?q="+URLEncoder.encode(q,"UTF-8"));
                JSONArray rows=j.optJSONArray("rows");if(rows==null||rows.length()==0)throw new Exception("Endereço não encontrado.");
                JSONObject p=rows.getJSONObject(0);JSONObject s=new JSONObject();
                String confirmed=p.optString("label",q);
                boolean approximate=p.optBoolean("approximate",false);
                s.put("lat",p.getDouble("lat"));
                s.put("lon",p.getDouble("lon"));
                s.put("original",q);
                s.put("label",confirmed);
                s.put("resolved",confirmed);
                s.put("approximate",approximate);
                s.put("precision",p.optString("precision",""));
                stops.add(s);
                if(start==null)start=new JSONObject(s.toString());
                runOnUiThread(()->{
                    address.setText("");
                    refreshStartPointUi();
                    status.setText(stops.size()==1?"Primeiro endereço definido como ponto de partida"+(prefs.getBoolean("current_return_start",true)?" e retorno.":"."):"Parada adicionada.");
                    renderList();renderMap(null);
                });
            }catch(Exception e){runOnUiThread(()->status.setText("Erro: "+e.getMessage()));}
        });
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
                for(JSONObject s:stops){
                    double lat=s.optDouble("lat",Double.NaN),lon=s.optDouble("lon",Double.NaN);
                    boolean sameStart=Double.isFinite(slat)&&Double.isFinite(slon)&&Double.isFinite(lat)&&Double.isFinite(lon)
                        &&Math.abs(lat-slat)<0.000001&&Math.abs(lon-slon)<0.000001;
                    if(!sameStart)arr.put(new JSONObject(s.toString()));
                }
                if(arr.length()<1)throw new Exception("Adicione pelo menos uma parada além do ponto de partida.");
                body.put("stops",arr);
                body.put("start",effectiveStart);
                body.put("returnToStart",returnToStart);
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
                    ordered.add(startPoint);
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
                    status.setText("Rota otimizada com sucesso.");
                    renderList();renderMap(j);
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
        if(lastPlan==null)summary.setText(stops.size()+" parada"+(stops.size()==1?"":"s"));
        if(stops.isEmpty()){
            TextView empty=label("Nenhuma parada adicionada ainda.",13,MUTED,false);empty.setGravity(Gravity.CENTER);empty.setPadding(dp(8),dp(18),dp(8),dp(18));list.addView(empty);return;
        }
        for(int i=0;i<stops.size();i++){
            final int idx=i;JSONObject s=stops.get(i);
            LinearLayout row=new LinearLayout(this);row.setOrientation(LinearLayout.VERTICAL);row.setPadding(dp(10),dp(10),dp(8),dp(10));row.setBackground(strokedBg(Color.rgb(250,252,254),LINE,14));
            if(i>0){LinearLayout.LayoutParams rp=new LinearLayout.LayoutParams(-1,-2);rp.setMargins(0,dp(8),0,0);row.setLayoutParams(rp);}

            LinearLayout top=new LinearLayout(this);top.setOrientation(LinearLayout.HORIZONTAL);top.setGravity(Gravity.CENTER_VERTICAL);
            TextView num=label(String.valueOf(i+1),14,NAVY,true);num.setGravity(Gravity.CENTER);num.setBackground(bg(GREEN,50));top.addView(num,new LinearLayout.LayoutParams(dp(36),dp(36)));

            LinearLayout info=new LinearLayout(this);info.setOrientation(LinearLayout.VERTICAL);info.setPadding(dp(10),0,dp(6),0);
            String confirmed=s.optString("resolved",s.optString("label","Parada"));
            String original=s.optString("original","");
            TextView t=label(confirmed,14,TEXT,true);t.setMaxLines(3);
            info.addView(t);
            if(s.optBoolean("approximate",false)){
                TextView approx=label("Localização aproximada da rua/CEP",11,Color.rgb(185,93,0),true);
                approx.setPadding(0,dp(2),0,0);info.addView(approx);
            }
            if(!original.isEmpty()&&!original.equalsIgnoreCase(confirmed)){
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
            LinearLayout.LayoutParams bp=new LinearLayout.LayoutParams(dp(42),dp(42));bp.setMargins(dp(4),0,0,0);top.addView(up,bp);
            LinearLayout.LayoutParams bp2=new LinearLayout.LayoutParams(dp(42),dp(42));bp2.setMargins(dp(4),0,0,0);top.addView(del,bp2);
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

    private void openStopInMaps(JSONObject s){
        String d=stopCoords(s);
        try{
            Intent i=new Intent(Intent.ACTION_VIEW,Uri.parse("google.navigation:q="+Uri.encode(d)+"&mode=d"));
            i.setPackage("com.google.android.apps.maps");
            startActivity(i);
        }catch(Exception e){
            startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://www.google.com/maps/dir/?api=1&destination="+Uri.encode(d)+"&travelmode=driving")));
        }
    }

    private void openStopInWaze(JSONObject s){
        String d=stopCoords(s);
        try{
            startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://waze.com/ul?ll="+Uri.encode(d)+"&navigate=yes")));
        }catch(Exception e){
            status.setText("Não foi possível abrir o Waze.");
        }
    }

    private void navigateFirst(){
        if(stops.isEmpty()){status.setText("Nenhuma parada.");return;}
        final JSONObject s=stops.get(0);
        new AlertDialog.Builder(this)
            .setTitle("Abrir próxima parada")
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
        if(account!=null)account.setText("Modo teste");
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
