import { useGetProject } from "@workspace/api-client-react";

export function useProjectPolling(id: string) {
  const { data: projectDetail, isLoading } = useGetProject(id, {
    query: {
      refetchInterval: (query) => {
        const p = query.state.data;
        const isRunning = p && ["parsing", "queued", "analyzing", "generating", "exporting"].includes(p.status);
        return isRunning ? 3000 : false;
      },
    },
  });

  return { projectDetail, isLoading };
}
