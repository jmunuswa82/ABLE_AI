import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetProject, getGetProjectQueryKey } from '@workspace/api-client-react';

// Custom hook to poll project data when jobs are active
export function useProjectPolling(projectId: string) {
  const queryClient = useQueryClient();
  
  const { data: projectDetail, isLoading, error } = useGetProject(projectId, {
    query: {
      refetchInterval: (query) => {
        // If there's a project and it has running jobs, poll every 2 seconds
        const hasRunningJobs = query.state.data?.jobs?.some(
          job => !['completed', 'failed', 'exported', 'analyzed', 'generated', 'parsed'].includes(job.state)
        );
        return hasRunningJobs ? 2000 : false;
      },
    }
  });

  return { projectDetail, isLoading, error };
}
