import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';
import BoardSidebar from '../components/whiteboard/BoardSidebar.js';
import WhiteboardCanvas from '../components/whiteboard/WhiteboardCanvas.js';
import TaskEditorPanel from '../components/tasks/TaskEditorPanel.js';
import { useBoards, useCreateBoard } from '../hooks/whiteboard.js';

export default function WhiteboardPage() {
  const [params, setParams] = useSearchParams();
  const boardId = params.get('board');
  const openTaskId = params.get('task');
  const { data: boards } = useBoards();
  const createBoard = useCreateBoard();
  const activeBoard = boards?.find((b) => b.id === boardId);

  const selectBoard = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set('board', id);
      else n.delete('board');
      return n;
    });

  const openTask = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set('task', id);
      else n.delete('task');
      return n;
    });

  // Default to the first board (or create one) once the list has loaded and none is selected.
  useEffect(() => {
    if (!boards || boardId) return;
    if (boards.length > 0) {
      selectBoard(boards[0].id);
    } else if (!createBoard.isPending) {
      createBoard.mutate('My Whiteboard', { onSuccess: (b) => selectBoard(b.id) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, boardId]);

  return (
    <div className="flex h-[calc(100vh-6.5rem)] w-full">
      <BoardSidebar activeBoardId={boardId} onSelectBoard={selectBoard} />
      <div className="relative min-w-0 flex-1">
        {boardId ? (
          <WhiteboardCanvas key={boardId} boardId={boardId} boardName={activeBoard?.name ?? 'whiteboard'} onOpenTask={openTask} />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400 dark:text-neutral-500">
            <LayoutGrid size={16} />
            Loading whiteboards…
          </div>
        )}
      </div>
      {openTaskId && <TaskEditorPanel taskId={openTaskId} onClose={() => openTask(null)} onOpen={openTask} />}
    </div>
  );
}
