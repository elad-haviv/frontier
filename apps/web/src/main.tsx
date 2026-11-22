import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import { DialogProvider } from "./components/Dialogs.tsx";
import { TipProvider } from "./components/ui/Tip.tsx";
import { ToastProvider } from "./components/ui/Toast.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <TipProvider>
        <ToastProvider>
          <DialogProvider>
            <App />
          </DialogProvider>
        </ToastProvider>
      </TipProvider>
    </BrowserRouter>
  </StrictMode>,
);
