import { useCallback, useEffect, useState } from "react";

import {
  batchCreateTasks,
  batchTransitionTasks,
  createWhtTask,
  getWhtTask,
  importHistoricalTasks,
  importPayees,
  listIncomeTypes,
  listPayees,
  listWhtTasks,
  savePayee,
  transitionWhtTask,
} from "./api";
import type {
  IncomeTypeOption,
  Payee,
  PayeeInput,
  WhtTask,
  WhtTaskCreateInput,
} from "./types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

export function useWhtData() {
  const [tasks, setTasks] = useState<WhtTask[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [incomeTypes, setIncomeTypes] = useState<IncomeTypeOption[]>([]);
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

    // 收入类型目录单独取、失败不影响主数据：它只是把输入框从"自由文本"
    // 升级成"带建议的自由文本"，取不到就退回自由输入，不该让整个台账打不开。
    // 目录只有十来条且不随数据变化，所以整份取回、按 PND 类型在前端过滤。
    try {
      setIncomeTypes(await listIncomeTypes());
    } catch {
      setIncomeTypes([]);
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

  const uploadBatchTasks = useCallback(async (file: File) => {
    setMutationPending(true);
    try {
      const result = await batchCreateTasks(file);
      setTasks(await listWhtTasks());
      return result;
    } finally {
      setMutationPending(false);
    }
  }, []);

  const runBatchTransition = useCallback(
    async (
      action: "submit-review" | "approve" | "return-to-draft",
      selection: WhtTask[],
    ) => {
      setMutationPending(true);
      try {
        const result = await batchTransitionTasks(action, selection);
        // 批量流转允许部分成功，本地无法逐条推断新状态，直接重新拉一遍列表。
        setTasks(await listWhtTasks());
        return result;
      } finally {
        setMutationPending(false);
      }
    },
    [],
  );

  return {
    tasks,
    payees,
    incomeTypes,
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
    uploadBatchTasks,
    runBatchTransition,
  };
}
