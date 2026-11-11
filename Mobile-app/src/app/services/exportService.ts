import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { dialogService } from "../context/CustomDialogContext";

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
            dialogService.toast.success("File CSV siap dibagikan", { description: filename });
          } else {
            dialogService.toast.success("File CSV tersimpan di Dokumen", { description: filename });
          }
        } catch (_) {
          dialogService.toast.success("File CSV tersimpan di penyimpanan lokal", { description: filename });
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
        dialogService.toast.success("File CSV berhasil diunduh", { description: filename });
        return true;
      }
    } catch (err) {
      console.error("Gagal mengekspor file CSV:", err);
      dialogService.toast.error("Gagal menyimpan file CSV", {
        description: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  public static async exportImage(filename: string, base64DataUrl: string): Promise<boolean> {
    try {
      if (Capacitor.isNativePlatform()) {
        const rawBase64 = base64DataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
        const writeResult = await Filesystem.writeFile({
          path: filename,
          data: rawBase64,
          directory: Directory.Documents,
        });

        try {
          const canShareRes = await Share.canShare();
          if (canShareRes.value) {
            await Share.share({
              title: filename,
              text: `Laporan Komparasi Biometrik Gait: ${filename}`,
              url: writeResult.uri,
              dialogTitle: "Simpan atau Bagikan Gambar Komparasi",
            });
            dialogService.toast.success("Gambar komparasi siap dibagikan", { description: filename });
          } else {
            dialogService.toast.success("Gambar tersimpan di Dokumen", { description: filename });
          }
        } catch (_) {
          dialogService.toast.success("Gambar tersimpan di penyimpanan lokal", { description: filename });
        }
        return true;
      } else {
        const a = document.createElement("a");
        a.href = base64DataUrl;
        a.download = filename;
        a.click();
        dialogService.toast.success("Gambar komparasi berhasil diunduh", { description: filename });
        return true;
      }
    } catch (err) {
      console.error("Gagal mengekspor file gambar:", err);
      dialogService.toast.error("Gagal menyimpan gambar", {
        description: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
}
