/**
 * Document Management Dashboard
 * Main dashboard for managing reference materials and their RAG embeddings
 */
import { useState, useEffect } from 'react';
import { DocumentStats } from './DocumentStats';
import { DocumentList } from './DocumentList';
import { DocumentDetail } from './DocumentDetail';
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { RefreshCw, FileText, BarChart3, AlertTriangle } from 'lucide-react';
import { toast } from '@/contexts/ToastContext';
import { api } from '@/lib/api-client';

interface DashboardStats {
  total_documents: number;
  total_chunks: number;
  total_tokens: number;
  by_status: Record<string, number>;
  by_format: Record<string, number>;
  by_processor: Record<string, number>;
  storage_used_mb: number;
  last_ingestion: string | null;
  pending_count: number;
  failed_count: number;
}

export function DocumentDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await api.get('/documents/dashboard/stats');
      setStats(response.data);
    } catch (error) {
      toast.error('Failed to load document statistics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleDocumentSelect = (docId: string) => {
    setSelectedDocId(docId);
    setActiveTab('detail');
  };

  const handleBackToList = () => {
    setSelectedDocId(null);
    setActiveTab('documents');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Document Management
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Manage reference materials and RAG embeddings
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchStats}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Quick Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total Documents</p>
                  <p className="text-2xl font-bold">{stats.total_documents}</p>
                </div>
                <FileText className="h-8 w-8 text-purple-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total Chunks</p>
                  <p className="text-2xl font-bold">{stats.total_chunks.toLocaleString()}</p>
                </div>
                <BarChart3 className="h-8 w-8 text-blue-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Storage Used</p>
                  <p className="text-2xl font-bold">{stats.storage_used_mb} MB</p>
                </div>
                <BarChart3 className="h-8 w-8 text-green-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card className={stats.failed_count > 0 ? 'border-red-200 dark:border-red-800' : ''}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Failed / Pending</p>
                  <p className="text-2xl font-bold">
                    <span className={stats.failed_count > 0 ? 'text-red-500' : ''}>
                      {stats.failed_count}
                    </span>
                    {' / '}
                    <span className="text-yellow-500">{stats.pending_count}</span>
                  </p>
                </div>
                <AlertTriangle className={`h-8 w-8 opacity-50 ${stats.failed_count > 0 ? 'text-red-500' : 'text-gray-400'}`} />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          {selectedDocId && <TabsTrigger value="detail">Document Detail</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <DocumentStats stats={stats} loading={loading} />
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <DocumentList onSelectDocument={handleDocumentSelect} />
        </TabsContent>

        <TabsContent value="detail" className="mt-4">
          {selectedDocId && (
            <DocumentDetail documentId={selectedDocId} onBack={handleBackToList} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export { DocumentStats } from './DocumentStats';
export { DocumentList } from './DocumentList';
export { DocumentDetail } from './DocumentDetail';

