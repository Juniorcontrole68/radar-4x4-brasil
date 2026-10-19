package br.com.movit.rotas;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.util.Base64;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Comprovantes de entrega da rota do dia. Cada comprovante é gravado no celular antes de ser
 * enviado: sem sinal ele fica guardado e sobe na próxima vez que o app abrir ou atualizar.
 * O servidor ignora o reenvio do mesmo comprovante (client_uuid).
 */
final class Comprovantes {
    static final String PATH="/api/router-app/company/comprovante";
    private Comprovantes(){}

    private static File pasta(Context c){File d=new File(c.getFilesDir(),"comprovantes");d.mkdirs();return d;}

    static void guardar(Context c,JSONObject corpo)throws IOException{
        File tmp=new File(pasta(c),corpo.optString("client_uuid")+".tmp");
        try(OutputStream o=new FileOutputStream(tmp)){o.write(corpo.toString().getBytes(StandardCharsets.UTF_8));}
        if(!tmp.renameTo(new File(pasta(c),corpo.optString("client_uuid")+".json")))throw new IOException("Não foi possível guardar o comprovante.");
    }

    /** Paradas com comprovante ainda não enviado: chave -> resultado ("entregue" ou o motivo da falha). */
    static Map<String,String> pendentes(Context c){
        Map<String,String> out=new HashMap<>();
        File[] fs=pasta(c).listFiles((d,n)->n.endsWith(".json"));
        if(fs!=null)for(File f:fs){
            try{
                JSONObject j=ler(f),st=j.optJSONObject("stop");
                String k=st==null?"":st.optString("chave","");
                if(!k.isEmpty())out.put(k,"falhou".equals(j.optString("resultado"))?j.optString("motivo","outro"):"entregue");
            }catch(Exception ignored){}
        }
        return out;
    }

    /** Envia o que estiver guardado. Devolve quantos ainda ficaram (sem sinal). */
    static int enviarPendentes(Context c,String token){
        File[] fs=pasta(c).listFiles((d,n)->n.endsWith(".json"));
        if(fs==null)return 0;
        Arrays.sort(fs,(a,b)->Long.compare(a.lastModified(),b.lastModified()));
        int restam=0;
        for(File f:fs){
            try{
                Api.postAuth(PATH,ler(f),token);
                f.delete();
            }catch(Api.HttpError e){
                // 4xx: o servidor recusou o conteúdo (data vencida, parada inválida). Reenviar não
                // adianta. 401 e 5xx podem passar: fica guardado.
                if(e.code>=400&&e.code<500&&e.code!=401&&e.code!=429)f.delete();else restam++;
            }catch(Exception e){restam++;}
        }
        return restam;
    }

    private static JSONObject ler(File f)throws Exception{
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;
        try(InputStream in=new FileInputStream(f)){while((n=in.read(b))>0)out.write(b,0,n);}
        return new JSONObject(out.toString("UTF-8"));
    }

    /**
     * Foto da câmera -> {foto, miniatura} em "data:image/jpeg;base64,...". A foto sai com no máximo
     * 1280 px no lado maior (~150-300 KB): o servidor guarda no banco e a banda do Render é pouca.
     */
    static String[] prepararFoto(File arquivo)throws IOException{
        BitmapFactory.Options o=new BitmapFactory.Options();o.inJustDecodeBounds=true;
        BitmapFactory.decodeFile(arquivo.getAbsolutePath(),o);
        if(o.outWidth<=0||o.outHeight<=0)throw new IOException("A foto não foi gravada. Tire de novo.");
        int amostra=1;while(Math.max(o.outWidth,o.outHeight)/(amostra*2)>=1280)amostra*=2;
        BitmapFactory.Options o2=new BitmapFactory.Options();o2.inSampleSize=amostra;
        Bitmap bmp=BitmapFactory.decodeFile(arquivo.getAbsolutePath(),o2);
        if(bmp==null)throw new IOException("A foto não foi gravada. Tire de novo.");
        int giro=0;
        try{
            int ori=new ExifInterface(arquivo.getAbsolutePath()).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL);
            giro=ori==ExifInterface.ORIENTATION_ROTATE_90?90:ori==ExifInterface.ORIENTATION_ROTATE_180?180:ori==ExifInterface.ORIENTATION_ROTATE_270?270:0;
        }catch(Exception ignored){}
        Bitmap foto=escalar(bmp,1280,giro),mini=escalar(bmp,320,giro);
        String f=jpeg(foto,72);
        if(f.length()>780000)f=jpeg(foto,55);
        String m=jpeg(mini,60);
        return new String[]{f,m};
    }
    private static Bitmap escalar(Bitmap b,int max,int giro){
        float k=Math.min(1f,(float)max/Math.max(b.getWidth(),b.getHeight()));
        Matrix mx=new Matrix();mx.postScale(k,k);if(giro!=0)mx.postRotate(giro);
        return Bitmap.createBitmap(b,0,0,b.getWidth(),b.getHeight(),mx,true);
    }
    private static String jpeg(Bitmap b,int q){
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.JPEG,q,out);
        return "data:image/jpeg;base64,"+Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP);
    }
}
