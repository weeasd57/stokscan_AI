"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export default function LabDialogShell({
  title,
  subtitle,
  ar,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  ar: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/75" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed bottom-3 left-1/2 z-[111] w-[calc(100%-1.5rem)] max-w-4xl -translate-x-1/2 outline-none md:bottom-auto md:top-1/2 md:-translate-y-1/2"
          dir={ar ? "rtl" : "ltr"}
        >
          <div className="app-panel-strong app-text-primary flex max-h-[88vh] flex-col overflow-hidden rounded-2xl !transform-none">
            <header className="flex shrink-0 flex-wrap items-center gap-3 border-b-[3px] border-[var(--brutal-border)] px-4 py-4 md:px-6">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-base font-black md:text-lg">
                  {title}
                </Dialog.Title>
                {subtitle && (
                  <p className="app-text-muted mt-1 text-[11px] font-semibold">
                    {subtitle}
                  </p>
                )}
              </div>
              <Dialog.Close
                aria-label={ar ? "إغلاق" : "Close"}
                className="app-icon-button shrink-0 rounded-xl p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </header>
            <div className="min-h-0 overflow-y-auto px-4 py-5 md:px-6">
              {children}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
