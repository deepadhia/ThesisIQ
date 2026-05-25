import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DriveOAuthCallback } from "@/components/DriveOAuthCallback";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import StocksPage from "./pages/StocksPage";
import StockDetailPage from "./pages/StockDetailPage";
import TranscriptsPage from "./pages/TranscriptsPage";
import SignalsPage from "./pages/SignalsPage";
import CalendarPage from "./pages/CalendarPage";
import NotFound from "./pages/NotFound";
import LoginPage from "./pages/LoginPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <DriveOAuthCallback />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Index />} />
              <Route path="/stocks" element={<StocksPage />} />
              <Route path="/stocks/:id" element={<StockDetailPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/transcripts" element={<TranscriptsPage />} />
              <Route path="/signals" element={<SignalsPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
