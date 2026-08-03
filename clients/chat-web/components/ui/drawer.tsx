"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Drawer = DialogPrimitive.Root;
const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerClose = DialogPrimitive.Close;
const DrawerPortal = DialogPrimitive.Portal;
const DrawerOverlay = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(({ className, ...props }, ref) => <DialogPrimitive.Overlay className={cn("fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[1px]", className)} {...props} ref={ref} />);
DrawerOverlay.displayName = DialogPrimitive.Overlay.displayName;
const DrawerContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>>(({ className, children, ...props }, ref) => <DrawerPortal><DrawerOverlay /><DialogPrimitive.Content ref={ref} className={cn("fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl focus:outline-none", className)} {...props}>{children}<DialogPrimitive.Close className="absolute right-5 top-5 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"><X className="h-5 w-5" /><span className="sr-only">关闭</span></DialogPrimitive.Close></DialogPrimitive.Content></DrawerPortal>);
DrawerContent.displayName = DialogPrimitive.Content.displayName;
const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("border-b border-slate-100 px-6 py-5", className)} {...props} />;
const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("mt-auto flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4", className)} {...props} />;
const DrawerTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(({ className, ...props }, ref) => <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-slate-950", className)} {...props} />);
DrawerTitle.displayName = DialogPrimitive.Title.displayName;
const DrawerDescription = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(({ className, ...props }, ref) => <DialogPrimitive.Description ref={ref} className={cn("mt-1 text-sm text-slate-500", className)} {...props} />);
DrawerDescription.displayName = DialogPrimitive.Description.displayName;
export { Drawer, DrawerTrigger, DrawerClose, DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription };
