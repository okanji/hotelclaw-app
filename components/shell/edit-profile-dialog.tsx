"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { updateAvatar, updateProfile } from "@/lib/auth/profile-actions";
import { createClient } from "@/lib/supabase/client";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string | null;
  initialAvatarUrl: string | null;
  email: string;
  userId: string;
};

const AVATARS_BUCKET = "avatars";
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function EditProfileDialog({
  open,
  onOpenChange,
  initialName,
  initialAvatarUrl,
  email,
  userId,
}: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initialName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [busy, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFullName(initialName ?? "");
      setAvatarUrl(initialAvatarUrl);
      setError(null);
    }
  }, [open, initialName, initialAvatarUrl]);

  const initials = (initialName ?? email)
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await updateProfile({ fullName });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success("Profile updated");
      onOpenChange(false);
      router.refresh();
    });
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same filename later
    if (!file) return;

    if (!ALLOWED_TYPES.has(file.type)) {
      toast.error("Use a PNG, JPEG, WebP, or GIF image");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image must be 2 MB or smaller");
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${userId}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(AVATARS_BUCKET)
        .upload(path, file, {
          contentType: file.type,
          cacheControl: "3600",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from(AVATARS_BUCKET)
        .getPublicUrl(path);

      const result = await updateAvatar(data.publicUrl);
      if ("error" in result) {
        // Roll back the orphan upload — the action didn't persist anything.
        await supabase.storage.from(AVATARS_BUCKET).remove([path]);
        throw new Error(result.error);
      }

      setAvatarUrl(data.publicUrl);
      toast.success("Avatar updated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function onRemoveAvatar() {
    if (!avatarUrl) return;
    setUploading(true);
    startTransition(async () => {
      const result = await updateAvatar(null);
      setUploading(false);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setAvatarUrl(null);
      toast.success("Avatar removed");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your profile</DialogTitle>
          <DialogDescription>
            This is how teammates see you in chat, mentions, and the members
            list.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar className="size-16">
              <AvatarImage src={avatarUrl ?? undefined} alt="" />
              <AvatarFallback className="text-base">
                {initials || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || busy}
                >
                  <Upload />
                  {uploading ? "Uploading…" : "Upload new"}
                </Button>
                {avatarUrl ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onRemoveAvatar}
                    disabled={uploading || busy}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                PNG, JPEG, WebP, or GIF. Max 2 MB.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              name="avatar"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={onPickFile}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-name">Full name</Label>
            <Input
              id="profile-name"
              name="fullName"
              autoFocus
              required
              minLength={1}
              maxLength={120}
              autoComplete="name"
              placeholder="Jamie Rivera"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Email</Label>
            <p className="font-mono text-xs text-muted-foreground">{email}</p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy || uploading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={busy || uploading || !fullName.trim()}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
