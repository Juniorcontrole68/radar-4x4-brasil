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
    private static final int REQ_VOICE=10,REQ_LOC=11;
    private final ArrayList<JSONObject> stops=new ArrayList<>();
    private final ExecutorService exec=Executors.newSingleThreadExecutor();
    private LinearLayout list;
    private EditText address;
    private TextView status,summary;
    private WebView map;
    private JSONObject start=null,lastPlan=null;
    private android.content.SharedPreferences prefs;
    private TextView account;
    private Button cloudSave,cloudRoutes;

    @Override public void onCreate(Bundle b){
        super.onCreate(b);prefs=getSharedPreferences("rv2_account",MODE_PRIVATE);buildUi();renderList();renderMap(null);refreshAccount();
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
        Button b=new Button(this);b.setText(text);b.setTextColor(textColor);b.setTextSize(14);b.setAllCaps(false);
        b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);b.setBackground(bg(fill,14));
        b.setPadding(dp(14),dp(8),dp(14),dp(8));b.setMinHeight(dp(44));b.setStateListAnimator(null);
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
        final int NAVY=Color.rgb(22,20,47),GREEN=Color.rgb(99,202,67),BG=Color.rgb(246,248,251),TEXT=Color.rgb(30,41,59),MUTED=Color.rgb(100,116,139),LINE=Color.rgb(226,232,240);

        getWindow().setStatusBarColor(NAVY);getWindow().setNavigationBarColor(NAVY);

        LinearLayout page=new LinearLayout(this);page.setOrientation(LinearLayout.VERTICAL);page.setBackgroundColor(BG);

        ScrollView outer=new ScrollView(this);outer.setFillViewport(true);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(16),dp(14),dp(16),dp(22));
        outer.addView(root,new ScrollView.LayoutParams(-1,-2));page.addView(outer,new LinearLayout.LayoutParams(-1,0,1));

        // Cabeçalho MOVIT
        LinearLayout hero=card(16);hero.setBackground(bg(NAVY,22));
        LinearLayout heroRow=new LinearLayout(this);heroRow.setOrientation(LinearLayout.HORIZONTAL);heroRow.setGravity(Gravity.CENTER_VERTICAL);
        ImageView logo=new ImageView(this);logo.setImageResource(br.com.movit.rotas.R.drawable.ic_movit);logo.setBackground(bg(Color.WHITE,16));logo.setPadding(dp(8),dp(8),dp(8),dp(8));
        heroRow.addView(logo,new LinearLayout.LayoutParams(dp(62),dp(62)));
        LinearLayout heroText=new LinearLayout(this);heroText.setOrientation(LinearLayout.VERTICAL);heroText.setPadding(dp(14),0,0,0);
        TextView title=label("MOVIT",28,Color.WHITE,true);
        TextView sub=label("Autonomia, Renda e Movimento",13,GREEN,true);
        TextView sub2=label("Roteirização simples, rápida e inteligente",12,Color.rgb(203,213,225),false);
        heroText.addView(title);heroText.addView(sub);heroText.addView(sub2);
        heroRow.addView(heroText,new LinearLayout.LayoutParams(0,-2,1));
        hero.addView(heroRow);

        LinearLayout quick=new LinearLayout(this);quick.setOrientation(LinearLayout.HORIZONTAL);quick.setPadding(0,dp(12),0,0);
        account=label("MODO TESTE",11,Color.WHITE,true);account.setBackground(bg(Color.argb(40,255,255,255),10));account.setGravity(Gravity.CENTER);account.setPadding(dp(10),dp(6),dp(10),dp(6));
        cloudSave=pill("Salvar rota",Color.WHITE,NAVY);cloudSave.setOnClickListener(v->saveCloud());
        cloudRoutes=pill("Rotas salvas",Color.rgb(44,42,73),Color.WHITE);cloudRoutes.setOnClickListener(v->loadCloudRoutes());
        quick.addView(account,new LinearLayout.LayoutParams(0,dp(40),1));
        LinearLayout.LayoutParams qp=new LinearLayout.LayoutParams(0,dp(44),1);qp.setMargins(dp(8),0,0,0);
        quick.addView(cloudSave,qp);LinearLayout.LayoutParams qp2=new LinearLayout.LayoutParams(0,dp(44),1);qp2.setMargins(dp(8),0,0,0);quick.addView(cloudRoutes,qp2);
        hero.addView(quick);root.addView(hero);

        gap(root,12);

        // Card de endereço
        LinearLayout addCard=card(15);
        TextView addTitle=label("Adicionar parada",17,TEXT,true);addCard.addView(addTitle);
        TextView addHelp=label("Digite ou fale a rua e a cidade. O número é opcional.",12,MUTED,false);addHelp.setPadding(0,dp(3),0,dp(10));addCard.addView(addHelp);

        address=new EditText(this);address.setHint("Ex.: Rua Domingos Carotti, Indaiatuba");address.setSingleLine(true);address.setTextSize(16);address.setTextColor(TEXT);address.setHintTextColor(Color.rgb(148,163,184));address.setBackground(strokedBg(Color.rgb(250,252,254),LINE,14));address.setPadding(dp(14),0,dp(14),0);
        addCard.addView(address,new LinearLayout.LayoutParams(-1,dp(54)));

        LinearLayout addRow=new LinearLayout(this);addRow.setOrientation(LinearLayout.HORIZONTAL);addRow.setPadding(0,dp(10),0,0);
        Button voice=pill("🎙  Falar",Color.rgb(238,242,247),NAVY);voice.setOnClickListener(v->voice());
        Button loc=pill("📍  Minha localização",Color.rgb(238,242,247),NAVY);loc.setOnClickListener(v->useLocation());
        Button add=pill("+  Adicionar",GREEN,NAVY);add.setOnClickListener(v->addAddress(address.getText().toString()));
        LinearLayout.LayoutParams ap1=new LinearLayout.LayoutParams(0,dp(48),1);
        LinearLayout.LayoutParams ap2=new LinearLayout.LayoutParams(0,dp(48),1.35f);ap2.setMargins(dp(8),0,0,0);
        LinearLayout.LayoutParams ap3=new LinearLayout.LayoutParams(0,dp(48),1.2f);ap3.setMargins(dp(8),0,0,0);
        addRow.addView(voice,ap1);addRow.addView(loc,ap2);addRow.addView(add,ap3);
        addCard.addView(addRow);

        status=label("Adicione pelo menos duas paradas para começar.",12,MUTED,false);status.setPadding(0,dp(10),0,0);addCard.addView(status);
        root.addView(addCard);

        gap(root,12);

        // Resumo
        LinearLayout summaryCard=card(14);summaryCard.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout left=new LinearLayout(this);left.setOrientation(LinearLayout.VERTICAL);
        TextView sm=label("RESUMO DA ROTA",11,MUTED,true);summary=label("0 paradas",20,NAVY,true);summary.setPadding(0,dp(3),0,0);left.addView(sm);left.addView(summary);
        summaryCard.addView(left,new LinearLayout.LayoutParams(0,-2,1));
        TextView tip=label("As paradas serão reorganizadas automaticamente.",11,MUTED,false);tip.setGravity(Gravity.END|Gravity.CENTER_VERTICAL);summaryCard.addView(tip,new LinearLayout.LayoutParams(0,-1,1));
        root.addView(summaryCard);

        gap(root,12);

        // Mapa
        LinearLayout mapCard=card(0);mapCard.setClipToOutline(true);
        TextView mapTitle=label("Mapa da rota",16,TEXT,true);mapTitle.setPadding(dp(15),dp(14),dp(15),dp(8));mapCard.addView(mapTitle);
        map=new WebView(this);map.getSettings().setJavaScriptEnabled(true);map.setBackgroundColor(Color.WHITE);
        mapCard.addView(map,new LinearLayout.LayoutParams(-1,dp(320)));
        root.addView(mapCard);

        gap(root,12);

        // Ações principais
        LinearLayout actions=card(12);actions.setOrientation(LinearLayout.HORIZONTAL);
        Button optimize=pill("⚡ Otimizar",GREEN,NAVY);optimize.setOnClickListener(v->optimize());
        Button navigate=pill("▶ Navegar",NAVY,Color.WHITE);navigate.setOnClickListener(v->navigateFirst());
        Button clear=pill("Limpar",Color.rgb(241,245,249),Color.rgb(71,85,105));clear.setOnClickListener(v->{stops.clear();lastPlan=null;summary.setText("0 paradas");renderList();renderMap(null);status.setText("Rota limpa.");});
        LinearLayout.LayoutParams ac1=new LinearLayout.LayoutParams(0,dp(50),1.15f);
        LinearLayout.LayoutParams ac2=new LinearLayout.LayoutParams(0,dp(50),1.15f);ac2.setMargins(dp(8),0,0,0);
        LinearLayout.LayoutParams ac3=new LinearLayout.LayoutParams(0,dp(50),.75f);ac3.setMargins(dp(8),0,0,0);
        actions.addView(optimize,ac1);actions.addView(navigate,ac2);actions.addView(clear,ac3);
        root.addView(actions);

        gap(root,12);

        // Lista de paradas
        LinearLayout stopsCard=card(14);
        TextView stopsTitle=label("Paradas",17,TEXT,true);stopsCard.addView(stopsTitle);
        TextView stopsHelp=label("A primeira parada será a próxima após a otimização.",12,MUTED,false);stopsHelp.setPadding(0,dp(2),0,dp(8));stopsCard.addView(stopsHelp);
        list=new LinearLayout(this);list.setOrientation(LinearLayout.VERTICAL);stopsCard.addView(list,new LinearLayout.LayoutParams(-1,-2));
        root.addView(stopsCard);

        setContentView(page);
    }

    private void voice(){
        Intent i=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"pt-BR");
        i.putExtra(RecognizerIntent.EXTRA_PROMPT,"Fale o endereço completo");
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
            start=new JSONObject();start.put("lat",l.getLatitude());start.put("lon",l.getLongitude());start.put("label","Minha localização");
            status.setText("Ponto de início definido pela sua localização.");
        }catch(Exception e){status.setText("Não foi possível usar sua localização.");}
    }

    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){
        super.onRequestPermissionsResult(requestCode,permissions,grantResults);
        if(requestCode==REQ_LOC&&grantResults.length>0&&grantResults[0]==PackageManager.PERMISSION_GRANTED)useLocation();
    }

    private void addAddress(String raw){
        raw=raw.trim();if(raw.length()<5){status.setText("Informe um endereço mais completo.");return;}
        final String q=raw;status.setText("Localizando endereço…");
        exec.execute(()->{
            try{
                JSONObject j=Api.get("/api/public-router/geocode?q="+URLEncoder.encode(q,"UTF-8"));
                JSONArray rows=j.optJSONArray("rows");if(rows==null||rows.length()==0)throw new Exception("Endereço não encontrado.");
                JSONObject p=rows.getJSONObject(0);JSONObject s=new JSONObject();
                s.put("lat",p.getDouble("lat"));s.put("lon",p.getDouble("lon"));s.put("label",q);s.put("resolved",p.optString("label",q));
                stops.add(s);
                runOnUiThread(()->{address.setText("");status.setText("Parada adicionada.");renderList();renderMap(null);});
            }catch(Exception e){runOnUiThread(()->status.setText("Erro: "+e.getMessage()));}
        });
    }

    private void optimize(){
        if(stops.size()<2){status.setText("Adicione pelo menos duas paradas.");return;}
        status.setText("Otimizando pelas vias reais…");
        exec.execute(()->{
            try{
                JSONObject body=new JSONObject();JSONArray arr=new JSONArray();
                for(JSONObject s:stops)arr.put(new JSONObject(s.toString()));
                body.put("stops",arr);if(start!=null)body.put("start",start);
                JSONObject j=Api.post("/api/public-router/optimize",body);lastPlan=j;
                JSONArray order=j.getJSONArray("order");ArrayList<JSONObject> ordered=new ArrayList<>();
                JSONArray points=j.getJSONArray("points");
                for(int i=0;i<order.length();i++)ordered.add(points.getJSONObject(order.getInt(i)));
                stops.clear();stops.addAll(ordered);
                runOnUiThread(()->{status.setText("Rota otimizada.");summary.setText(stops.size()+" paradas • "+fmtKm(j.optDouble("distanceMeters",0))+" • "+fmtTime(j.optDouble("durationSeconds",0)));renderList();renderMap(j);});
            }catch(Exception e){runOnUiThread(()->status.setText("Erro: "+e.getMessage()));}
        });
    }

    private String fmtKm(double m){return String.format(Locale.forLanguageTag("pt-BR"),"%.1f km",m/1000d);}
    private String fmtTime(double sec){long min=Math.round(sec/60d);return min>=60?(min/60+"h "+min%60+"min"):(min+" min");}

    private void renderList(){
        final int NAVY=Color.rgb(22,20,47),GREEN=Color.rgb(99,202,67),TEXT=Color.rgb(30,41,59),MUTED=Color.rgb(100,116,139),LINE=Color.rgb(226,232,240);
        list.removeAllViews();
        if(lastPlan==null)summary.setText(stops.size()+" parada"+(stops.size()==1?"":"s"));
        if(stops.isEmpty()){
            TextView empty=label("Nenhuma parada adicionada ainda.",13,MUTED,false);empty.setGravity(Gravity.CENTER);empty.setPadding(dp(8),dp(18),dp(8),dp(18));list.addView(empty);return;
        }
        for(int i=0;i<stops.size();i++){
            final int idx=i;JSONObject s=stops.get(i);
            LinearLayout row=new LinearLayout(this);row.setOrientation(LinearLayout.HORIZONTAL);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(dp(10),dp(10),dp(8),dp(10));row.setBackground(strokedBg(Color.rgb(250,252,254),LINE,14));
            if(i>0){LinearLayout.LayoutParams rp=new LinearLayout.LayoutParams(-1,-2);rp.setMargins(0,dp(8),0,0);row.setLayoutParams(rp);}

            TextView num=label(String.valueOf(i+1),14,NAVY,true);num.setGravity(Gravity.CENTER);num.setBackground(bg(GREEN,50));row.addView(num,new LinearLayout.LayoutParams(dp(36),dp(36)));

            LinearLayout info=new LinearLayout(this);info.setOrientation(LinearLayout.VERTICAL);info.setPadding(dp(10),0,dp(6),0);
            TextView t=label(s.optString("label","Parada"),14,TEXT,true);t.setMaxLines(2);
            String resolved=s.optString("resolved","");
            TextView r=label(resolved.isEmpty()?"Endereço confirmado":resolved,11,MUTED,false);r.setMaxLines(2);r.setPadding(0,dp(2),0,0);
            info.addView(t);info.addView(r);row.addView(info,new LinearLayout.LayoutParams(0,-2,1));

            Button up=pill("↑",Color.rgb(238,242,247),NAVY);up.setTextSize(17);up.setPadding(0,0,0,0);up.setEnabled(idx>0);up.setAlpha(idx>0?1f:.35f);
            up.setOnClickListener(v->{if(idx>0){Collections.swap(stops,idx,idx-1);lastPlan=null;renderList();renderMap(null);}});
            Button del=pill("×",Color.rgb(255,241,242),Color.rgb(190,24,93));del.setTextSize(20);del.setPadding(0,0,0,0);
            del.setOnClickListener(v->{stops.remove(idx);lastPlan=null;renderList();renderMap(null);status.setText("Parada removida.");});
            LinearLayout.LayoutParams bp=new LinearLayout.LayoutParams(dp(42),dp(42));bp.setMargins(dp(4),0,0,0);
            row.addView(up,bp);LinearLayout.LayoutParams bp2=new LinearLayout.LayoutParams(dp(42),dp(42));bp2.setMargins(dp(4),0,0,0);row.addView(del,bp2);
            list.addView(row);
        }
    }

    private void navigateFirst(){
        if(stops.isEmpty()){status.setText("Nenhuma parada.");return;}
        JSONObject s=stops.get(0);String d=s.optDouble("lat")+","+s.optDouble("lon");
        Intent i=new Intent(Intent.ACTION_VIEW,Uri.parse("google.navigation:q="+Uri.encode(d)+"&mode=d"));
        i.setPackage("com.google.android.apps.maps");
        try{startActivity(i);}catch(Exception e){startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://www.google.com/maps/dir/?api=1&destination="+Uri.encode(d)+"&travelmode=driving")));}
    }

    private void renderMap(JSONObject plan){
        String points="[]",geometry="null";
        try{
            JSONArray a=new JSONArray();
            for(JSONObject s:stops){JSONArray p=new JSONArray();p.put(s.getDouble("lat"));p.put(s.getDouble("lon"));a.put(p);}
            points=a.toString();
            if(plan!=null&&plan.optJSONObject("geometry")!=null)geometry=plan.getJSONObject("geometry").toString();
        }catch(Exception ignored){}
        String html="<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"+
        "<link rel='stylesheet' href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'><style>html,body,#m{height:100%;margin:0}</style></head><body><div id='m'></div>"+
        "<script src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'></script><script>var m=L.map('m').setView([-22.8,-47.2],9);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(m);"+
        "var pts="+points+";pts.forEach((p,i)=>L.marker(p).addTo(m).bindTooltip(String(i+1)));var g="+geometry+";if(g&&g.coordinates){var ll=g.coordinates.map(x=>[x[1],x[0]]);L.polyline(ll,{weight:6,color:'#5fca43',opacity:.92,lineCap:'round',lineJoin:'round'}).addTo(m);if(ll.length)m.fitBounds(ll,{padding:[20,20]});}else if(pts.length)m.fitBounds(pts,{padding:[30,30]});</script></body></html>";
        map.loadDataWithBaseURL("https://app.local/",html,"text/html","UTF-8",null);
    }

    private String token(){return prefs.getString("token","");}
    private String userName(){return prefs.getString("name","");}
    private String userPlan(){return prefs.getString("plan","free");}

    private void refreshAccount(){
        account.setText("Modo teste • sem cadastro");
        cloudSave.setEnabled(true);
        cloudRoutes.setEnabled(true);
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
        if(lastPlan!=null){
            data.put("distanceMeters",lastPlan.optDouble("distanceMeters",0));
            data.put("durationSeconds",lastPlan.optDouble("durationSeconds",0));
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

}
