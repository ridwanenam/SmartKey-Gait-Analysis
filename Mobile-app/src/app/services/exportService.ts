import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { dialogService } from "../context/CustomDialogContext";

interface ExportOptions {
  filename: string;
  data: string;
  encoding?: Encoding;
  shareText: string;
  dialogTitle: string;
  itemLabel: string;
  webDownloadUrl: () => { url: string; revoke: boolean };
}

export class ExportService {
  /**
   * Menulis file ke penyimpanan Android dengan fallback otomatis dari Directory.Documents
   * ke penyimpanan privat aplikasi (Cache/Data) agar tidak gagal EACCES akibat Scoped Storage.
   */
  private static async writeNativeWithFallback(
    filename: string,
    data: string,
    encoding?: Encoding
  ): Promise<{ uri: string; inPublicDocuments: boolean }> {
    let hasPublicStorageAccess = false;
    try {
      const perm = await Filesystem.checkPermissions();
      if (perm.publicStorage === "granted") {
        hasPublicStorageAccess = true;
      } else {
        const req = await Filesystem.requestPermissions();
        hasPublicStorageAccess = req.publicStorage === "granted";
      }
    } catch {
      // Pada Android 11+ (API 30+), check/request publicStorage bisa tidak relevan;
      // tetap coba tulis dan gunakan fallback bila ditolak oleh Scoped Storage.
      hasPublicStorageAccess = true;
    }

    if (hasPublicStorageAccess) {
      try {
        const res = await Filesystem.writeFile({
          path: filename,
          data,
          directory: Directory.Documents,
          ...(encoding ? { encoding } : {}),
          recursive: true,
        });
        return { uri: res.uri, inPublicDocuments: true };
      } catch (err) {
        console.warn("[ExportService] Directory.Documents gagal, fallback ke Cache:", err);
      }
    }

    // Fallback aman tanpa butuh izin Scoped Storage; kompatibel dengan FileProvider Share
    const fallbackDirs = [Directory.Cache, Directory.Data];
    let lastError: unknown = null;
    for (const dir of fallbackDirs) {
      try {
        const res = await Filesystem.writeFile({
          path: filename,
          data,
          directory: dir,
          ...(encoding ? { encoding } : {}),
          recursive: true,
        });
        return { uri: res.uri, inPublicDocuments: false };
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * Menangani ekspor file secara seragam untuk platform native Android maupun Browser Web.
   */
  private static async exportFile(opts: ExportOptions): Promise<boolean> {
    const { filename, data, encoding, shareText, dialogTitle, itemLabel, webDownloadUrl } = opts;

    try {
      if (Capacitor.isNativePlatform()) {
        const { uri, inPublicDocuments } = await this.writeNativeWithFallback(filename, data, encoding);

        try {
          const canShareRes = await Share.canShare();
          if (canShareRes.value) {
            await Share.share({
              title: filename,
              text: shareText,
              url: uri,
              dialogTitle,
            });
            dialogService.toast.success(`${itemLabel} siap dibagikan`, { description: filename });
          } else {
            dialogService.toast.success(
              inPublicDocuments ? `${itemLabel} tersimpan di Dokumen` : `${itemLabel} tersimpan di penyimpanan aplikasi`,
              { description: filename }
            );
          }
        } catch {
          dialogService.toast.success(
            inPublicDocuments ? `${itemLabel} tersimpan di Dokumen` : `${itemLabel} siap di penyimpanan lokal`,
            { description: filename }
          );
        }

        return true;
      } else {
        const { url, revoke } = webDownloadUrl();
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        if (revoke) {
          URL.revokeObjectURL(url);
        }
        dialogService.toast.success(`${itemLabel} berhasil diunduh`, { description: filename });
        return true;
      }
    } catch (err) {
      console.error(`Gagal mengekspor ${itemLabel}:`, err);
      dialogService.toast.error(`Gagal menyimpan ${itemLabel}`, {
        description: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  public static async exportCSV(filename: string, csvContent: string): Promise<boolean> {
    return this.exportFile({
      filename,
      data: csvContent,
      encoding: Encoding.UTF8,
      shareText: `Export Data Gait Security: ${filename}`,
      dialogTitle: "Simpan atau Bagikan CSV",
      itemLabel: "File CSV",
      webDownloadUrl: () => {
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        return { url: URL.createObjectURL(blob), revoke: true };
      },
    });
  }

  public static async exportImage(filename: string, base64DataUrl: string): Promise<boolean> {
    const rawBase64 = base64DataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
    return this.exportFile({
      filename,
      data: rawBase64,
      shareText: `Laporan Komparasi Biometrik Gait: ${filename}`,
      dialogTitle: "Simpan atau Bagikan Gambar Komparasi",
      itemLabel: "Gambar komparasi",
      webDownloadUrl: () => ({ url: base64DataUrl, revoke: false }),
    });
  }
}
