import { useState } from "react";
import { useNavigate } from "react-router";
import { FolderSearch, Upload } from "lucide-react";
import { useSession } from "@/state/session";
import { importFiles } from "@/services/importer";
import { scanFoldersNow } from "@/services/folderWatch";
import { toast } from "@/state/toasts";
import { isTauri } from "@/platform";
import { Button } from "@/components/ui";
import { cls } from "@/lib/format";

/**
 * The one action Summa is about: get new invoices in. On the desktop with connected folders it looks through
 * the folders, otherwise it opens the file picker (or the camera on the phone).
 */
export function useIntake() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const hasFolders = useSession((s) => !!s.vault?.settings.watchFolders.some((f) => f.active && f.profileId === s.vault?.activeProfileId));
  const canScan = isTauri && hasFolders;

  const upload = async (capture = false) => {
    const platform = useSession.getState().platform!;
    const files = await platform.pickFiles({ multiple: !capture, capture });
    if (files.length) {
      importFiles(files, capture ? "camera" : "upload");
      navigate("/belege");
    }
  };

  const scan = async () => {
    setBusy(true);
    try {
      const n = await scanFoldersNow();
      if (n) {
        toast.success(`${n} neue Datei${n === 1 ? "" : "en"} gefunden`, "Summa liest sie jetzt und bucht, was eindeutig ist.");
        navigate("/belege");
      } else toast.info("Nichts Neues", "In deinen Ordnern liegen keine neuen Dateien.");
    } catch (e) {
      toast.error("Ordner konnten nicht gelesen werden", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    canScan,
    label: canScan ? "Nach Neuem suchen" : "Rechnungen hinzufügen",
    hint: canScan ? "Schaut in deine Ordner und liest neue Rechnungen ein" : "PDF, Foto oder Scan auswählen – oder einfach ins Fenster ziehen",
    run: () => (canScan ? scan() : upload()),
    upload,
  };
}

export function IntakeButton({ className, size = "md" }: { className?: string; size?: "md" | "lg" }) {
  const intake = useIntake();
  return (
    <Button size={size} className={cls("justify-center", className)} loading={intake.busy} onClick={() => void intake.run()} title={intake.hint}>
      {intake.busy ? null : intake.canScan ? <FolderSearch className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
      {intake.label}
    </Button>
  );
}
