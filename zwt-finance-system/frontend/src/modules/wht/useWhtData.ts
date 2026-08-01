import { useCallback, useEffect, useState } from "react";

import {
  batchTransitionTasks,
  commitBatchTasks,
  createWhtTask,
  deletePayee,
  getWhtTask,
  importHistoricalTasks,
  importPayees,
  listIncomeTypes,
  listPayees,
  listWhtTasks,
  previewBatchTasks,
  restorePayee,
  reviseWhtTask,
  savePayee,
  transitionWhtTask,
  updateWhtTask,
} from "./api";
import type {
  BatchCommitInput,
  IncomeTypeOption,
  Payee,
  PayeeInput,
  WhtTask,
  WhtTaskCreateInput,
  WhtTaskUpdateInput,
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

  const removePayee = useCallback(async (payeeId: string) => {
    setMutationPending(true);
    try {
      const deleted = await deletePayee(payeeId);
      setPayees((current) => current.filter((payee) => payee.id !== payeeId));
      return deleted;
    } finally {
      setMutationPending(false);
    }
  }, []);

  const recoverPayee = useCallback(async (payeeId: string) => {
    setMutationPending(true);
    try {
      const restored = await restorePayee(payeeId);
      setPayees((current) => [restored, ...current]);
      return restored;
    } finally {
      setMutationPending(false);
    }
  }, []);

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

  const editTask = useCallback(
    async (task: WhtTask, input: WhtTaskUpdateInput) => {
      setMutationPending(true);
      try {
        const updated = await updateWhtTask(task, input);
        replaceTask(updated);
        return updated;
      } finally {
        setMutationPending(false);
      }
    },
    [replaceTask],
  );

  const reviseTask = useCallback(
    async (task: WhtTask, reason: string) => {
      setMutationPending(true);
      try {
        const revised = await reviseWhtTask(task, reason);
        replaceTask(revised);
        return revised;
      } finally {
        setMutationPending(false);
      }
    },
    [replaceTask],
  );

  /** 分步开票第一步。只读，所以不动 tasks，也不算 mutation。 */
  const previewBatch = useCallback((file: File) => previewBatchTasks(file), []);

  const commitBatch = useCallback(async (input: BatchCommitInput) => {
    setMutationPending(true);
    try {
      const result = await commitBatchTasks(input);
      // 新草稿可能带着刚补录的收款方（批准时才写库），两份列表都重取。
      const [nextTasks, nextPayees] = await Promise.all([listWhtTasks(), listPayees()]);
      setTasks(nextTasks);
      setPayees(nextPayees);
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
    editTask,
    reviseTask,
    transitionTask,
    persistPayee,
    removePayee,
    recoverPayee,
    uploadPayees,
    uploadHistoricalTasks,
    previewBatch,
    commitBatch,
    runBatchTransition,
  };
}
