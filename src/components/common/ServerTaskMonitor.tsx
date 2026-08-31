import React, { useState, useEffect } from 'react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Terminal, Cpu, X, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Loader2, StopCircle, RefreshCw } from 'lucide-react';

interface ServerJob {
  docId: string;
  title: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  lastLog: string;
  logs: string[];
  elapsedSeconds: number;
}

export const ServerTaskMonitor: React.FC = () => {
  const syncServerUrl = useSettingsStore((s) => s.syncServerUrl);
  const [jobs, setJobs] = useState<ServerJob[]>([]);
  const [activeCount, setActiveCount] = useState<number>(0);
  const [isOpen, setIsOpen] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});

  const [serverStatus, setServerStatus] = useState<'connected' | 'offline' | 'needs_restart'>('connected');

  useEffect(() => {
    if (!syncServerUrl) return;

    let isCurrent = true;

    const fetchJobs = async () => {
      try {
        const res = await fetch(`${syncServerUrl}/api/system/jobs`);
        if (res.ok) {
          const data = await res.json();
          if (isCurrent) {
            setJobs(data.jobs || []);
            setActiveCount(data.activeCount || 0);
            setServerStatus('connected');
          }
        } else if (res.status === 404) {
          if (isCurrent) setServerStatus('needs_restart');
        } else {
          if (isCurrent) setServerStatus('offline');
        }
      } catch (e) {
        if (isCurrent) setServerStatus('offline');
      }
    };

    fetchJobs();
    // Wenn Tasks laufen, alle 2s aktualisieren, sonst alle 5s
    const intervalTime = activeCount > 0 ? 2000 : 5000;
    const timer = setInterval(fetchJobs, intervalTime);

    return () => {
      isCurrent = false;
      clearInterval(timer);
    };
  }, [syncServerUrl, activeCount]);

  const handleCancelJob = async (docId: string) => {
    if (!syncServerUrl) return;
    try {
      await fetch(`${syncServerUrl}/api/system/jobs/${docId}/cancel`, { method: 'POST' });
      setJobs((prev) =>
        prev.map((j) => (j.docId === docId ? { ...j, status: 'cancelled', lastLog: 'Abgebrochen' } : j))
      );
    } catch (e) {
      console.error('Cancel failed', e);
    }
  };

  const toggleLog = (docId: string) => {
    setExpandedLogs((prev) => ({ ...prev, [docId]: !prev[docId] }));
  };

  // Wenn keine Sync Server URL konfiguriert ist, ausblenden
  if (!syncServerUrl) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end pointer-events-auto">
      {/* Aufgeklapptes Debug-Panel */}
      {isOpen && (
        <div className="w-96 max-w-[90vw] max-h-[70vh] bg-neutral-900/95 border border-neutral-700 rounded-xl shadow-2xl backdrop-blur-md flex flex-col overflow-hidden mb-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          {/* Header */}
          <div className="p-3 bg-neutral-950/80 border-b border-neutral-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className={`w-4 h-4 ${activeCount > 0 ? 'text-amber-400 animate-spin' : 'text-emerald-400'}`} />
              <h3 className="text-xs font-semibold text-neutral-200">
                Server Tasks & Python Docling
              </h3>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Status-Hinweis bei 404 (Node.js Server läuft mit altem Code) */}
          {serverStatus === 'needs_restart' && (
            <div className="p-3 bg-amber-950/40 border-b border-amber-800/50 text-xs text-amber-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Backend-Server neu starten</p>
                <p className="text-[11px] text-amber-300/80 mt-0.5">
                  Im Terminal am PC einmal <code className="bg-amber-900/60 px-1 py-0.5 rounded text-amber-100">node server.js</code> neu starten, damit die neuen Monitor-Routen geladen werden.
                </p>
              </div>
            </div>
          )}

          {/* Job-Liste */}
          <div className="p-3 overflow-y-auto space-y-3 divide-y divide-neutral-800/60">
            {jobs.length === 0 ? (
              <div className="text-center py-6 text-neutral-500 text-xs">
                <CheckCircle2 className="w-6 h-6 text-neutral-600 mx-auto mb-2" />
                Keine aktiven Python-Tasks im Hintergrund.
              </div>
            ) : (
              jobs.map((job) => (
              <div key={job.docId} className="pt-2 first:pt-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {job.status === 'running' ? (
                        <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                      ) : job.status === 'completed' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      )}
                      <span className="text-xs font-medium text-neutral-200 truncate" title={job.title}>
                        {job.title}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-1 text-[11px] text-neutral-400">
                      <span
                        className={`px-1.5 py-0.2 rounded font-mono text-[10px] ${
                          job.status === 'running'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800/40'
                            : job.status === 'completed'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/40'
                            : 'bg-red-950 text-red-300 border border-red-800/40'
                        }`}
                      >
                        {job.status === 'running' ? 'Verarbeitet' : job.status === 'completed' ? 'Fertig' : 'Gestoppt'}
                      </span>
                      <span>⏱️ {job.elapsedSeconds}s</span>
                    </div>
                  </div>

                  {job.status === 'running' && (
                    <button
                      onClick={() => handleCancelJob(job.docId)}
                      className="p-1 text-red-400 hover:text-red-300 rounded hover:bg-red-950/50 text-[11px] flex items-center gap-1 shrink-0 border border-red-900/40"
                      title="Prozess beenden"
                    >
                      <StopCircle className="w-3.5 h-3.5" />
                      Stop
                    </button>
                  )}
                </div>

                {/* Letzte Log-Zeile */}
                <p className="text-[11px] font-mono text-neutral-400 bg-neutral-950/60 p-1.5 rounded mt-2 truncate border border-neutral-800/50">
                  {job.lastLog}
                </p>

                {/* Log-Details Toggle */}
                {job.logs && job.logs.length > 0 && (
                  <div className="mt-1">
                    <button
                      onClick={() => toggleLog(job.docId)}
                      className="text-[10px] text-neutral-500 hover:text-neutral-300 flex items-center gap-1 font-mono"
                    >
                      {expandedLogs[job.docId] ? (
                        <>
                          <ChevronUp className="w-3 h-3" /> Logs verbergen
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3 h-3" /> Vollständige Logs anzeigen ({job.logs.length})
                        </>
                      )}
                    </button>

                    {expandedLogs[job.docId] && (
                      <div className="mt-1.5 p-2 bg-black/80 rounded border border-neutral-800 max-h-40 overflow-y-auto font-mono text-[10px] text-neutral-300 space-y-0.5 select-text">
                        {job.logs.map((line, idx) => (
                          <div key={idx} className="whitespace-pre-wrap leading-tight">
                            {line}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
          </div>
        </div>
      )}

      {/* Floating Status Button / Pill */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`px-3 py-2 rounded-full border shadow-xl flex items-center gap-2 transition-all cursor-pointer ${
          activeCount > 0
            ? 'bg-amber-950/90 hover:bg-amber-900 text-amber-200 border-amber-700/60 ring-2 ring-amber-500/20'
            : 'bg-neutral-900/90 hover:bg-neutral-800 text-neutral-300 border-neutral-700'
        }`}
      >
        {activeCount > 0 ? (
          <>
            <Cpu className="w-4 h-4 text-amber-400 animate-spin" />
            <span className="text-xs font-semibold">
              {activeCount} Python {activeCount === 1 ? 'Job' : 'Jobs'} aktiv
            </span>
          </>
        ) : (
          <>
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-medium">Server-Tasks</span>
          </>
        )}
      </button>
    </div>
  );
};
