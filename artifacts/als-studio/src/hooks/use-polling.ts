import { useGetProject } from "@workspace/api-client-react";

export function useProjectPolling(id: string | null) {
  const query = useGetProject(id ?? "", {
    query: {
      enabled: !!id,
      refetchInterval: (query) => {
        const state = query.state.data?.status;
        if (["parsing", "analyzing", "generating", "exporting", "queued"].includes(state ?? "")) {
          return 2000;
        }
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
