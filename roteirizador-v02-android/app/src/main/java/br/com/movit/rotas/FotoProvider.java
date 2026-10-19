package br.com.movit.rotas;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/**
 * Entrega ao app da câmera um arquivo do próprio MOVIT para gravar a foto da entrega, sem pedir
 * acesso à galeria. Só serve os arquivos da pasta de fotos temporárias e só para quem recebeu a
 * permissão no Intent (o provedor não é exportado).
 */
public class FotoProvider extends ContentProvider {
    static Uri uri(android.content.Context c,String nome){
        return Uri.parse("content://"+c.getPackageName()+".fotos/"+nome);
    }
    static File arquivo(android.content.Context c,String nome){
        File d=new File(c.getCacheDir(),"fotos");d.mkdirs();
        return new File(d,nome);
    }
    private File doUri(Uri u)throws FileNotFoundException{
        String nome=u.getLastPathSegment();
        if(nome==null||!nome.matches("[A-Za-z0-9_-]+\\.jpg"))throw new FileNotFoundException(String.valueOf(u));
        return arquivo(getContext(),nome);
    }
    @Override public boolean onCreate(){return true;}
    @Override public ParcelFileDescriptor openFile(Uri u,String mode)throws FileNotFoundException{
        File f=doUri(u);
        int m=mode.contains("w")?ParcelFileDescriptor.MODE_READ_WRITE|ParcelFileDescriptor.MODE_CREATE|ParcelFileDescriptor.MODE_TRUNCATE:ParcelFileDescriptor.MODE_READ_ONLY;
        return ParcelFileDescriptor.open(f,m);
    }
    @Override public String getType(Uri u){return "image/jpeg";}
    @Override public Cursor query(Uri u,String[] proj,String sel,String[] args,String order){
        try{
            File f=doUri(u);
            MatrixCursor c=new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE});
            c.addRow(new Object[]{f.getName(),f.length()});
            return c;
        }catch(FileNotFoundException e){return null;}
    }
    @Override public Uri insert(Uri u,ContentValues v){return null;}
    @Override public int delete(Uri u,String s,String[] a){return 0;}
    @Override public int update(Uri u,ContentValues v,String s,String[] a){return 0;}
}
