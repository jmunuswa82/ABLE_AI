import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import ProjectDetail from "@/pages/ProjectDetail";
import TimelineView from "@/pages/TimelineView";
import CompletionPlanView from "@/pages/CompletionPlanView";
import ExportView from "@/pages/ExportView";
import Layout from "@/components/Layout";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // 0 staleTime so polling hooks always get fresh data on remount.
      // Project/job status is always polled at 2s intervals when in-flight
      // so this does not cause extra network traffic for completed projects.
      staleTime: 0,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/projects/:id" component={ProjectDetail} />
        <Route path="/projects/:id/timeline" component={TimelineView} />
        <Route path="/projects/:id/plan" component={CompletionPlanView} />
        <Route path="/projects/:id/export" component={ExportView} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
