import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export class ExportService {
  public static async exportCSV(filename: string, csvContent: string): Promise<boolean> {
    try {
      if (Capacitor.isNativePlatform()) {
        // 1. Simpan ke Documents storage perangkat Android
        const writeResult = await Filesystem.writeFile({
          path: filename,
          data: csvContent,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });

        // 2. Buka menu Share Android agar user bisa langsung simpan ke Drive, Folder, WA, dll
        try {
          const canShareRes = await Share.canShare();
          if (canShareRes.value) {
            await Share.share({
              title: filename,
              text: `Export Data Gait Security: ${filename}`,
              url: writeResult.uri,
              dialogTitle: "Simpan atau Bagikan CSV",
            });
          } else {
            alert(`File berhasil disimpan ke folder Dokumen: ${filename}`);
          }
        } catch (_) {
          alert(`File CSV berhasil disimpan ke penyimpanan lokal: ${filename}`);
        }

        return true;
      } else {
        // Fallback untuk Browser Web
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return true;
      }
    } catch (err) {
      console.error("Gagal mengekspor file CSV:", err);
      alert(`Gagal menyimpan file: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
