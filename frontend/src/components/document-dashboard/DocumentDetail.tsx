/**
 * Document Detail Component
 * Shows full document details including processing history
 */
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, RefreshCw, ExternalLink, FileText, Clock, CheckCircle, XCircle, Hash } from 'lucide-react';
import { toast } from '@/contexts/ToastContext';
import { api } from '@/lib/api-client';

interface DocumentDetailData {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  uploadthing_url: string;
  embedding_status: string;
  sync_status: string;
  chunk_count: number;
  character_count: number | null;
  token_estimate: number | null;
  content_hash: string | null;
  page_count: number | null;
  processor_used: string | null;
  processing_time: number | null;
  embedding_version: number;
  processing_attempts: number;
  last_error: string | null;
  processing_history: Array<{
    timestamp: string;
    action: string;
    status: string;
    details?: Record<string, unknown>;
  }>;
  created_at: string;
  last_embedded_at: string | null;
  last_synced_at: string | null;
}

interface DocumentDetailProps {
  documentId: string;
  onBack: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentDetail({ documentId, onBack }: DocumentDetailProps) {
  const [document, setDocument] = useState<DocumentDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [resyncing, setResyncing] = useState(false);
  const fetchDocument = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/documents/dashboard/${documentId}`);
      setDocument(response.data);
    } catch (error) {
      toast.error('Failed to load document details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocument();
  }, [documentId]);

  const handleResync = async () => {
    try {
      setResyncing(true);
      await api.post(`/documents/${documentId}/resync?force=true`);
      toast.success('Document queued for re-sync');
      fetchDocument();
    } catch (error) {
      toast.error('Failed to resync document');
    } finally {
      setResyncing(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!document) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-gray-500">Document not found</p>
          <Button variant="outline" onClick={onBack} className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to List
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <div>
            <h2 className="text-xl font-bold">{document.filename}</h2>
            <p className="text-sm text-gray-500">ID: {document.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleResync} disabled={resyncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${resyncing ? 'animate-spin' : ''}`} />
            Force Resync
          </Button>
          {document.uploadthing_url && (
            <Button variant="outline" size="sm" asChild>
              <a href={document.uploadthing_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" /> View File
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              {document.embedding_status === 'completed' ? (
                <CheckCircle className="h-8 w-8 text-green-500" />
              ) : document.embedding_status === 'failed' ? (
                <XCircle className="h-8 w-8 text-red-500" />
              ) : (
                <Clock className="h-8 w-8 text-yellow-500" />
              )}
              <div>
                <p className="text-sm text-gray-500">Embedding Status</p>
                <Badge variant={document.embedding_status === 'completed' ? 'default' : document.embedding_status === 'failed' ? 'destructive' : 'secondary'}>
                  {document.embedding_status}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Hash className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-sm text-gray-500">Chunks / Tokens</p>
                <p className="font-bold">
                  {document.chunk_count} / {document.token_estimate?.toLocaleString() || 'N/A'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-purple-500" />
              <div>
                <p className="text-sm text-gray-500">Processor</p>
                <p className="font-bold capitalize">
                  {document.processor_used?.replace('_', ' ') || 'N/A'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Details Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Document Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-500">File Size</p>
              <p className="font-medium">{formatFileSize(document.size)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Content Type</p>
              <p className="font-medium">{document.content_type}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Page Count</p>
              <p className="font-medium">{document.page_count || 'N/A'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Character Count</p>
              <p className="font-medium">{document.character_count?.toLocaleString() || 'N/A'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Embedding Version</p>
              <p className="font-medium">v{document.embedding_version}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Processing Attempts</p>
              <p className="font-medium">{document.processing_attempts}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Processing Time</p>
              <p className="font-medium">
                {document.processing_time ? `${document.processing_time.toFixed(2)}s` : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Sync Status</p>
              <Badge variant="outline">{document.sync_status}</Badge>
            </div>
          </div>

          {document.content_hash && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-gray-500">Content Hash (SHA-256)</p>
              <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded break-all">
                {document.content_hash}
              </code>
            </div>
          )}

          {document.last_error && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-red-500 font-medium">Last Error</p>
              <p className="text-sm text-red-400 mt-1">{document.last_error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Processing History */}
      {document.processing_history && document.processing_history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Processing History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {document.processing_history.map((entry, index) => (
                <div key={index} className="flex items-start gap-4 pb-4 border-b last:border-0">
                  <div className="flex-shrink-0">
                    {entry.status === 'success' ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : entry.status === 'failed' ? (
                      <XCircle className="h-5 w-5 text-red-500" />
                    ) : (
                      <Clock className="h-5 w-5 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="font-medium capitalize">{entry.action.replace('_', ' ')}</p>
                      <span className="text-xs text-gray-400">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>
                    {entry.details && (
                      <pre className="text-xs text-gray-500 mt-1 bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-x-auto">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timestamps */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-6 text-sm text-gray-500">
            <div>
              <span className="font-medium">Created:</span>{' '}
              {new Date(document.created_at).toLocaleString()}
            </div>
            {document.last_embedded_at && (
              <div>
                <span className="font-medium">Last Embedded:</span>{' '}
                {new Date(document.last_embedded_at).toLocaleString()}
              </div>
            )}
            {document.last_synced_at && (
              <div>
                <span className="font-medium">Last Synced:</span>{' '}
                {new Date(document.last_synced_at).toLocaleString()}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

