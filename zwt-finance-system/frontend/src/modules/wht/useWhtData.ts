import { useCallback, useEffect, useState } from "react";

import {
  createWhtTask,
  getWhtTask,
  importHistoricalTasks,
  importPayees,
  listPayees,
  listWhtTasks,
  savePayee,
  transitionWhtTask,
} from "./api";
import type { Payee, PayeeInput, WhtTask, WhtTaskCreateInput } from "./types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

export function useWhtData() {
  const [tasks, setTasks] = useState<WhtTask[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [loading, setLoading] = useState(true);
  const [mutationPending, setMutationPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextTasks, nextPayees] = await Promise.all([listWhtTasks(), listPayees()]);
      setTasks(nextTasks);
      setPayees(nextPayees);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const replaceTask = useCallback((task: WhtTask) => {
    setTasks((current) => {
      const exists = current.some((item) => item.id === task.id);
      return exists
        ? current.map((item) => (item.id === task.id ? task : item))
        : [task, ...current];
    });
  }, []);

  const loadTaskDetail = useCallback(
    async (taskId: string) => {
      try {
        const task = await getWhtTask(taskId);
        replaceTask(task);
      } catch (loadError) {
        setError(errorMessage(loadError));
      }
    },
    [replaceTask],
  );

  const createTask = useCallback(
    async (input: WhtTaskCreateInput) => {
      setMutationPending(true);
      try {
        const task = await createWhtTask(input);
        replaceTask(task);
        return task;
      } finally {
        setMutationPending(false);
      }
    },
    [replaceTask],
  );

  const transitionTask = useCallback(
    async (
      task: WhtTask,
      action: "submit-review" | "approve" | "return-to-draft",
    ) => {
      setMutationPending(true);
      try {
        const updated = await transitionWhtTask(task, action);
        replaceTask(updated);
        return updated;
      } finally {
        setMutationPending(false);
      }
    },
    [replaceTask],
  );

  const persistPayee = useCallback(async (input: PayeeInput, payeeId?: string) => {
    setMutationPending(true);
    try {
      const payee = await savePayee(input, payeeId);
      setPayees((current) => {
        const exists = current.some((item) => item.id === payee.id);
        return exists
          ? current.map((item) => (item.id === payee.id ? payee : item))
          : [payee, ...current];
      });
      return payee;
    } finally {
      setMutationPending(false);
    }
  }, []);

  const uploadPayees = useCallback(
    async (file: File) => {
      setMutationPending(true);
      try {
        const result = await importPayees(file);
        setPayees(await listPayees());
        return result;
      } finally {
        setMutationPending(false);
      }
    },
    [],
  );

  const uploadHistoricalTasks = useCallback(async (file: File) => {
    setMutationPending(true);
    try {
      const result = await importHistoricalTasks(file);
      setTasks(await listWhtTasks());
      return result;
    } finally {
      setMutationPending(false);
    }
  }, []);

  return {
    tasks,
    payees,
    loading,
    mutationPending,
    error,
    reload,
    loadTaskDetail,
    createTask,
    transitionTask,
    persistPayee,
    uploadPayees,
    uploadHistoricalTasks,
  };
}
