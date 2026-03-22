import { useGetProject } from "@workspace/api-client-react";

export function useProjectPolling(id: string | null) {
  const query = useGetProject(id ?? "", {
    query: {
      enabled: !!id,
      refetchInterval: (query) => {
        const state = query.state.data?.status;
        const POLLING_STATUSES = ["parsing", "analyzing", "generating", "exporting", "queued", "applying", "uploaded"];
        if (POLLING_STATUSES.includes(state ?? "")) {
          return 2000;
        }
        // Terminal states: "exported", "failed" — stop polling
        return false;
      }
    }
  });

  return {
    projectDetail: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error
  };
}
