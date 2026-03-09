'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import {
  Search,
  TrendingUp,
  TrendingDown,
  Star,
  StarOff,
  Bell,
  RefreshCw,
  Loader2,
  BarChart3,
  Bot,
  Plus,
  Trash2,
  X,
  Send,
  Zap,
  Database,
  Globe,
  FileText,
  Building2,
  Scan,
  ArrowUpRight,
  ArrowDownRight,
  History,
  Sparkles,
  Upload,
  Image as ImageIcon,
  LineChart as LineChartIcon,
  User,
  LogIn,
  LogOut,
  UserPlus,
  LayoutDashboard,
  List,
  Users,
  AlertCircle,
  CheckCircle,
  Clock,
  Target,
  Wallet,
  PieChart,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ============================================
// TYPES
// ============================================

interface Stock {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  ceiling?: number;
  floor?: number;
}

interface WatchlistItem {
  id: string;
  symbol: string;
  name: string;
  targetPrice: number | null;
  notes: string | null;
  createdAt: string;
  currentPrice?: number;
  changePercent?: number;
  change?: number;
}

interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: string;
  active: boolean;
  triggered: boolean;
  createdAt: string;
  currentPrice?: number;
  distance?: string;
}

interface HistoricalData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PendingAction {
  tool: string;
  params: Record<string, unknown>;
  description: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolsUsed?: string[];
  pendingActions?: PendingAction[];
  suggestedQuestions?: string[];
  timestamp: Date;
  isStreaming?: boolean;
}

interface CurrentUser {
  id: string;
  rumuz: string;
  avatar: string | null;
  watchlistCount: number;
  alertsCount: number;
  createdAt: string;
}

interface ToolProgress {
  tool: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  message: string;
  result?: unknown;
}

// ============================================
// TOOL DEFINITIONS
// ============================================

const TOOLS = [
  { id: 'get_stock_price', name: 'Hisse Fiyatı', icon: BarChart3, color: 'text-emerald-400' },
  { id: 'get_stock_history', name: 'Geçmiş Veri', icon: History, color: 'text-blue-400' },
  { id: 'get_watchlist', name: 'Takip Listesi', icon: Star, color: 'text-yellow-400' },
  { id: 'web_search', name: 'Web Araması', icon: Globe, color: 'text-purple-400' },
  { id: 'get_kap_data', name: 'KAP Verileri', icon: Building2, color: 'text-cyan-400' },
  { id: 'scan_market', name: 'Piyasa Tarama', icon: Scan, color: 'text-pink-400' },
  { id: 'get_top_gainers', name: 'Yükselenler', icon: ArrowUpRight, color: 'text-emerald-400' },
  { id: 'get_top_losers', name: 'Düşenler', icon: ArrowDownRight, color: 'text-red-400' },
  { id: 'analyze_chart_image', name: 'Grafik Analizi', icon: LineChartIcon, color: 'text-violet-400' },
  { id: 'read_txt_file', name: 'TXT Analizi', icon: FileText, color: 'text-amber-400' },
];

// ============================================
// TAB DEFINITIONS
// ============================================

const TABS = [
  { id: 'dashboard', label: 'Ana Sayfa', icon: LayoutDashboard },
  { id: 'stocks', label: 'Hisseler', icon: Database },
  { id: 'watchlist', label: 'Takip Listem', icon: Star },
  { id: 'gainers', label: 'Yükselenler', icon: TrendingUp },
  { id: 'losers', label: 'Düşenler', icon: TrendingDown },
  { id: 'alerts', label: 'Bildirimler', icon: Bell },
];

// ============================================
// MAIN COMPONENT
// ============================================

export default function Home() {
  const { toast } = useToast();

  // State
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [filteredStocks, setFilteredStocks] = useState<Stock[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');

  // Market Summary
  const [marketSummary, setMarketSummary] = useState<{
    totalStocks: number;
    gainersCount: number;
    losersCount: number;
    avgChange: number;
  } | null>(null);
  const [topGainers, setTopGainers] = useState<Stock[]>([]);
  const [topLosers, setTopLosers] = useState<Stock[]>([]);

  // Detail Modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [historicalData, setHistoricalData] = useState<HistoricalData[]>([]);
  const [indicators, setIndicators] = useState<{
    sma20: number | null;
    sma50: number | null;
    rsi: number | null;
  } | null>(null);
  const [trend, setTrend] = useState<string | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState('1M');
  const [detailLoading, setDetailLoading] = useState(false);

  // AI Agent
  const [agentOpen, setAgentOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [toolProgress, setToolProgress] = useState<ToolProgress[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // File uploads
  const txtInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Auth
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [rumuzInput, setRumuzInput] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // ============================================
  // FETCH FUNCTIONS
  // ============================================

  const fetchCurrentUser = useCallback(async () => {
    try {
      const response = await fetch('/api/auth');
      const data = await response.json();
      if (data.success && data.user) {
        setCurrentUser(data.user);
      }
    } catch {
      console.error('Failed to fetch user');
    }
  }, []);

  const fetchStocks = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const response = await fetch('/api/stocks');
      const data = await response.json();

      if (data.success) {
        setStocks(data.data);
        setFilteredStocks(data.data);
      }
    } catch {
      toast({ title: 'Hata', description: 'Veriler alınamadı', variant: 'destructive' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  const fetchWatchlist = useCallback(async () => {
    try {
      const response = await fetch('/api/watchlist');
      const data = await response.json();
      if (data.success) setWatchlist(data.data);
    } catch { }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const response = await fetch('/api/alerts');
      const data = await response.json();
      if (data.success) setAlerts(data.data);
    } catch { }
  }, []);

  const fetchMarketSummary = useCallback(async () => {
    try {
      const response = await fetch('/api/market');
      const data = await response.json();
      if (data.success) {
        setMarketSummary({
          totalStocks: data.data.total,
          gainersCount: data.data.gainersCount,
          losersCount: data.data.losersCount,
          avgChange: data.data.avgChange
        });
        setTopGainers(data.data.gainers);
        setTopLosers(data.data.losers);
      }
    } catch { }
  }, []);

  // Initial load
  useEffect(() => {
    fetchStocks();
    fetchWatchlist();
    fetchAlerts();
    fetchCurrentUser();
    fetchMarketSummary();
  }, [fetchStocks, fetchWatchlist, fetchAlerts, fetchCurrentUser, fetchMarketSummary]);

  // Filter stocks
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredStocks(stocks);
      return;
    }
    const query = searchQuery.toLowerCase();
    setFilteredStocks(stocks.filter(s =>
      s.code.toLowerCase().includes(query) || s.name.toLowerCase().includes(query)
    ));
  }, [searchQuery, stocks]);

  // Auto scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ============================================
  // HELPER FUNCTIONS
  // ============================================

  const isInWatchlist = (symbol: string) => watchlist.some(item => item.symbol === symbol);

  const formatNumber = (num: number, decimals = 2) => {
    return num.toLocaleString('tr-TR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const formatVolume = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
    return num.toString();
  };

  // ============================================
  // WATCHLIST ACTIONS
  // ============================================

  const addToWatchlist = async (stock: Stock) => {
    try {
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: stock.code, name: stock.name }),
      });
      const data = await response.json();
      if (data.success) {
        setWatchlist(prev => [...prev, data.data]);
        toast({ title: 'Eklendi', description: `${stock.code} takibe alındı` });
      } else {
        toast({ title: 'Hata', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Hata', variant: 'destructive' });
    }
  };

  const removeFromWatchlist = async (symbol: string) => {
    try {
      await fetch(`/api/watchlist?symbol=${symbol}`, { method: 'DELETE' });
      setWatchlist(prev => prev.filter(item => item.symbol !== symbol));
      toast({ title: 'Kaldırıldı' });
    } catch {
      toast({ title: 'Hata', variant: 'destructive' });
    }
  };

  // ============================================
  // STOCK DETAIL
  // ============================================

  const openStockDetail = async (stock: Stock) => {
    setSelectedStock(stock);
    setDetailOpen(true);
    setDetailLoading(true);

    try {
      const response = await fetch(`/api/stocks/${stock.code}?period=${chartTimeframe}`);
      const data = await response.json();
      if (data.success) {
        setHistoricalData(data.data.historical);
        setIndicators(data.data.indicators);
        setTrend(data.data.trend);
      }
    } catch {
      console.error('Detail fetch error');
    } finally {
      setDetailLoading(false);
    }
  };

  const fetchHistoricalData = async (time: string) => {
    if (!selectedStock) return;
    setDetailLoading(true);
    setChartTimeframe(time);
    try {
      const response = await fetch(`/api/stocks/${selectedStock.code}?period=${time}`);
      const data = await response.json();
      if (data.success) setHistoricalData(data.data.historical);
    } catch { } finally {
      setDetailLoading(false);
    }
  };

  // ============================================
  // AI AGENT CHAT - SSE STREAMING
  // ============================================

  const sendToAgent = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setToolProgress([]);

    // Add user message
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    };
    setChatMessages(prev => [...prev, userMsg]);
    setChatLoading(true);

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });

      // Check if response is SSE stream
      const contentType = response.headers.get('Content-Type') || '';
      
      if (contentType.includes('text/event-stream')) {
        // Handle SSE streaming
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let accumulatedResponse = '';
        let toolsUsed: string[] = [];

        if (!reader) {
          throw new Error('Stream reader not available');
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const jsonStr = line.slice(6);
                const event = JSON.parse(jsonStr);

                switch (event.type) {
                  case 'progress':
                    // General progress update
                    setToolProgress(prev => [
                      { tool: 'query', status: 'running', message: event.data.message || 'İşleniyor...' },
                      ...prev.filter(p => p.tool !== 'query')
                    ]);
                    break;

                  case 'tool_start':
                    // Tool started running
                    setToolProgress(prev => {
                      const existing = prev.find(p => p.tool === event.data.tool);
                      if (existing) {
                        return prev.map(p => p.tool === event.data.tool 
                          ? { ...p, status: 'running', message: event.data.message }
                          : p
                        );
                      }
                      return [...prev, { 
                        tool: event.data.tool, 
                        status: 'running', 
                        message: event.data.message 
                      }];
                    });
                    break;

                  case 'tool_result':
                    // Tool completed
                    setToolProgress(prev => prev.map(p => 
                      p.tool === event.data.tool 
                        ? { ...p, status: 'completed', message: event.data.message, result: event.data.result }
                        : p
                    ));
                    break;

                  case 'complete':
                    // Final response
                    accumulatedResponse = event.data.response || '';
                    toolsUsed = event.data.toolsUsed || [];
                    
                    // Clear progress
                    setToolProgress([]);
                    
                    // Add assistant message
                    const assistantMsg: ChatMessage = {
                      id: (Date.now() + 1).toString(),
                      role: 'assistant',
                      content: accumulatedResponse,
                      toolsUsed: toolsUsed,
                      timestamp: new Date()
                    };
                    setChatMessages(prev => [...prev, assistantMsg]);

                    // Refresh watchlist if modified
                    if (toolsUsed.some(t => t.includes('watchlist') || t.includes('alert'))) {
                      fetchWatchlist();
                      fetchAlerts();
                    }
                    break;

                  case 'error':
                    setChatMessages(prev => [...prev, {
                      id: (Date.now() + 1).toString(),
                      role: 'assistant',
                      content: `Hata: ${event.data.error || 'Bir hata oluştu'}`,
                      timestamp: new Date()
                    }]);
                    setToolProgress([]);
                    break;
                }
              } catch {
                // Ignore JSON parse errors
              }
            }
          }
        }
      } else {
        // Fallback to regular JSON response
        const data = await response.json();
        
        if (data.success !== false) {
          const assistantMsg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: data.response,
            toolsUsed: data.toolsUsed,
            timestamp: new Date()
          };
          setChatMessages(prev => [...prev, assistantMsg]);
        } else {
          setChatMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Hata: ${data.error || 'Bir hata oluştu'}`,
            timestamp: new Date()
          }]);
        }
      }
    } catch (error) {
      console.error('Agent error:', error);
      setChatMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Bağlantı hatası. Lütfen tekrar deneyin.',
        timestamp: new Date()
      }]);
    } finally {
      setChatLoading(false);
      setToolProgress([]);
    }
  };

  // Confirm pending actions
  const confirmPendingActions = async (actions: PendingAction[], msgIdx: number) => {
    setChatMessages(prev => prev.map((m, i) =>
      i === msgIdx ? { ...m, pendingActions: undefined } : m
    ));
    setChatMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: '✅ Onayla',
      timestamp: new Date()
    }]);
    setChatLoading(true);

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmActions: actions }),
      });
      const data = await response.json();

      setChatMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.success ? data.response : 'İşlem sırasında hata oluştu.',
        toolsUsed: data.toolsUsed,
        timestamp: new Date()
      }]);

      if (data.toolsUsed?.some((t: string) => t.includes('watchlist') || t.includes('alert'))) {
        fetchWatchlist();
        fetchAlerts();
      }
    } catch {
      setChatMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Bağlantı hatası.',
        timestamp: new Date()
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Cancel pending actions
  const cancelPendingActions = (msgIdx: number) => {
    setChatMessages(prev => prev.map((m, i) =>
      i === msgIdx ? { ...m, pendingActions: undefined } : m
    ));
    setChatMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: '❌ İptal',
      timestamp: new Date()
    }, {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: 'İşlem iptal edildi.',
      timestamp: new Date()
    }]);
  };

  // TXT File Upload - SSE Streaming
  const handleTxtUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.txt')) {
      toast({ title: 'Hata', description: 'Sadece TXT dosyası', variant: 'destructive' });
      return;
    }

    setChatMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: `📄 Dosya: ${file.name}`,
      timestamp: new Date()
    }]);
    setChatLoading(true);
    setToolProgress([{ tool: 'read_txt_file', status: 'running', message: 'Dosya analiz ediliyor...' }]);

    try {
      const content = await file.text();
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txtContent: content, txtFilename: file.name }),
      });

      const contentType = response.headers.get('Content-Type') || '';
      
      if (contentType.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) throw new Error('Stream reader not available');

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6));
                
                if (event.type === 'tool_start') {
                  setToolProgress([{ tool: 'read_txt_file', status: 'running', message: event.data.message }]);
                } else if (event.type === 'tool_result') {
                  setToolProgress([{ tool: 'read_txt_file', status: 'completed', message: event.data.message }]);
                } else if (event.type === 'complete') {
                  setToolProgress([]);
                  setChatMessages(prev => [...prev, {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: event.data.response,
                    toolsUsed: event.data.toolsUsed,
                    timestamp: new Date()
                  }]);
                } else if (event.type === 'error') {
                  setToolProgress([]);
                  setChatMessages(prev => [...prev, {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: `Hata: ${event.data.error}`,
                    timestamp: new Date()
                  }]);
                }
              } catch { /* ignore */ }
            }
          }
        }
      } else {
        const data = await response.json();
        setToolProgress([]);
        if (data.success !== false) {
          setChatMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: data.response,
            toolsUsed: data.toolsUsed,
            timestamp: new Date()
          }]);
        } else {
          setChatMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Hata: ${data.error}`,
            timestamp: new Date()
          }]);
        }
      }
    } catch {
      setToolProgress([]);
      setChatMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Dosya okuma hatası.',
        timestamp: new Date()
      }]);
    } finally {
      setChatLoading(false);
      if (txtInputRef.current) txtInputRef.current.value = '';
    }
  };

  // Image Upload - SSE Streaming
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setChatMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: `📊 Grafik: ${file.name}`,
      timestamp: new Date()
    }]);
    setChatLoading(true);
    setToolProgress([{ tool: 'analyze_chart_image', status: 'running', message: 'Grafik analiz ediliyor...' }]);

    try {
      const fileReader = new FileReader();
      fileReader.onload = async (event) => {
        const base64 = event.target?.result as string;

        try {
          const response = await fetch('/api/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64 }),
          });

          const contentType = response.headers.get('Content-Type') || '';
          
          if (contentType.includes('text/event-stream')) {
            const streamReader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!streamReader) throw new Error('Stream reader not available');

            while (true) {
              const { done, value } = await streamReader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split('\n');

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const evt = JSON.parse(line.slice(6));
                    
                    if (evt.type === 'tool_start') {
                      setToolProgress([{ tool: 'analyze_chart_image', status: 'running', message: evt.data.message }]);
                    } else if (evt.type === 'tool_result') {
                      setToolProgress([{ tool: 'analyze_chart_image', status: 'completed', message: evt.data.message }]);
                    } else if (evt.type === 'complete') {
                      setToolProgress([]);
                      setChatMessages(prev => [...prev, {
                        id: (Date.now() + 1).toString(),
                        role: 'assistant',
                        content: evt.data.response,
                        toolsUsed: evt.data.toolsUsed,
                        timestamp: new Date()
                      }]);
                    } else if (evt.type === 'error') {
                      setToolProgress([]);
                      setChatMessages(prev => [...prev, {
                        id: (Date.now() + 1).toString(),
                        role: 'assistant',
                        content: `Hata: ${evt.data.error}`,
                        timestamp: new Date()
                      }]);
                    }
                  } catch { /* ignore */ }
                }
              }
            }
          } else {
            const data = await response.json();
            setToolProgress([]);
            if (data.success !== false) {
              setChatMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: data.response,
                toolsUsed: data.toolsUsed,
                timestamp: new Date()
              }]);
            } else {
              setChatMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `Hata: ${data.error}`,
                timestamp: new Date()
              }]);
            }
          }
        } catch {
          setToolProgress([]);
          setChatMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Analiz hatası.',
            timestamp: new Date()
          }]);
        }
        setChatLoading(false);
      };
      fileReader.readAsDataURL(file);
    } catch {
      setToolProgress([]);
      setChatMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Resim okuma hatası.',
        timestamp: new Date()
      }]);
      setChatLoading(false);
    }

    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  // ============================================
  // AUTH
  // ============================================

  const handleAuth = async () => {
    if (!rumuzInput.trim()) return;

    setAuthLoading(true);
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rumuz: rumuzInput.trim(),
          action: authMode,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setCurrentUser(data.user);
        setAuthOpen(false);
        setRumuzInput('');
        fetchWatchlist();
        fetchAlerts();
        toast({
          title: 'Başarılı',
          description: data.message
        });
      } else {
        toast({
          title: 'Hata',
          description: data.error,
          variant: 'destructive'
        });
      }
    } catch {
      toast({
        title: 'Hata',
        description: 'Bağlantı hatası',
        variant: 'destructive'
      });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    setCurrentUser(null);
    fetchWatchlist();
    fetchAlerts();
    toast({ title: 'Çıkış yapıldı' });
  };

  // ============================================
  // RENDER COMPONENTS
  // ============================================

  const StockCard = ({ stock, showWatchlistButton = true }: { stock: Stock; showWatchlistButton?: boolean }) => {
    const inWatchlist = isInWatchlist(stock.code);

    return (
      <div
        className="flex items-center justify-between p-3 hover:bg-slate-800/50 cursor-pointer transition-colors border-b border-slate-800 last:border-0"
        onClick={() => openStockDetail(stock)}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${stock.changePercent > 0 ? 'bg-emerald-600/20 text-emerald-400' :
            stock.changePercent < 0 ? 'bg-red-600/20 text-red-400' :
              'bg-slate-700 text-slate-400'
            }`}>
            {stock.code.slice(0, 2)}
          </div>
          <div>
            <p className="font-medium text-white">{stock.code}</p>
            <p className="text-xs text-slate-500 truncate max-w-[120px]">{stock.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="font-medium text-white">{formatNumber(stock.price)} ₺</p>
            <p className={`text-sm flex items-center gap-1 ${stock.changePercent > 0 ? 'text-emerald-400' :
              stock.changePercent < 0 ? 'text-red-400' :
                'text-slate-400'
              }`}>
              {stock.changePercent > 0 ? <ArrowUpRight className="h-3 w-3" /> :
                stock.changePercent < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
              {stock.changePercent >= 0 ? '+' : ''}{formatNumber(stock.changePercent)}%
            </p>
          </div>
          {showWatchlistButton && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (inWatchlist) {
                  removeFromWatchlist(stock.code);
                } else {
                  addToWatchlist(stock);
                }
              }}
              className={`p-2 rounded-lg transition-colors ${inWatchlist
                  ? 'text-yellow-400 hover:bg-yellow-400/10'
                  : 'text-slate-500 hover:bg-slate-700 hover:text-yellow-400'
                }`}
            >
              {inWatchlist ? <Star className="h-4 w-4 fill-current" /> : <Star className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>
    );
  };

  const SectionCard = ({
    title,
    icon: Icon,
    color,
    children,
    onSeeAll
  }: {
    title: string;
    icon: React.ElementType;
    color: string;
    children: React.ReactNode;
    onSeeAll?: () => void;
  }) => (
    <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <h3 className="font-semibold text-white flex items-center gap-2">
          <Icon className={`h-5 w-5 ${color}`} />
          {title}
        </h3>
        {onSeeAll && (
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white" onClick={onSeeAll}>
            Tümü
          </Button>
        )}
      </div>
      {children}
    </div>
  );

  // ============================================
  // MAIN RENDER
  // ============================================

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="bg-slate-900/80 backdrop-blur-sm border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4">
          {/* Search Row */}
          <div className="flex items-center gap-3 py-3">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                <Input
                  placeholder="Hisse ara... (kod veya ad, örn: THYAO, GARAN)"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (e.target.value.trim()) setActiveTab('stocks');
                  }}
                  className="pl-12 h-12 text-base bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-slate-700 text-slate-400 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fetchStocks(true)}
                disabled={refreshing}
                className="h-12 w-12 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                onClick={() => setAgentOpen(true)}
                className="h-12 px-4 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:opacity-90"
              >
                <Bot className="h-5 w-5 mr-2" />
                <span className="hidden sm:inline">AI Asistan</span>
              </Button>

              {/* User */}
              {currentUser ? (
                <button
                  onClick={handleLogout}
                  className="h-12 w-12 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-white font-bold text-lg hover:opacity-80 transition-opacity"
                  title={`@${currentUser.rumuz} - Çıkış yap`}
                >
                  {currentUser.rumuz.charAt(0).toUpperCase()}
                </button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setAuthOpen(true)}
                  className="h-12 px-4 border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  <LogIn className="h-5 w-5 mr-2" />
                  <span className="hidden sm:inline">Giriş</span>
                </Button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 pb-3 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-all ${activeTab === tab.id
                    ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
              >
                <tab.icon className="h-4 w-4" />
                <span className="text-sm font-medium">{tab.label}</span>
                {tab.id === 'watchlist' && watchlist.length > 0 && (
                  <Badge variant="secondary" className="bg-slate-700 text-slate-300 text-xs ml-1">
                    {watchlist.length}
                  </Badge>
                )}
                {tab.id === 'alerts' && alerts.length > 0 && (
                  <Badge variant="secondary" className="bg-slate-700 text-slate-300 text-xs ml-1">
                    {alerts.length}
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-[60vh]">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            <span className="ml-2 text-slate-400">Yükleniyor...</span>
          </div>
        ) : (
          <>
            {/* Dashboard Tab */}
            {activeTab === 'dashboard' && (
              <div className="space-y-6">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center">
                        <Database className="h-5 w-5 text-slate-400" />
                      </div>
                      <div>
                        <p className="text-sm text-slate-400">Toplam Hisse</p>
                        <p className="text-2xl font-bold text-white">{stocks.length}</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-slate-900 rounded-xl p-4 border border-emerald-800/30">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-emerald-600/20 flex items-center justify-center">
                        <TrendingUp className="h-5 w-5 text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-sm text-slate-400">Yükselenler</p>
                        <p className="text-2xl font-bold text-emerald-400">
                          {marketSummary?.gainersCount || stocks.filter(s => s.changePercent > 0).length}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-slate-900 rounded-xl p-4 border border-red-800/30">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-red-600/20 flex items-center justify-center">
                        <TrendingDown className="h-5 w-5 text-red-400" />
                      </div>
                      <div>
                        <p className="text-sm text-slate-400">Düşenler</p>
                        <p className="text-2xl font-bold text-red-400">
                          {marketSummary?.losersCount || stocks.filter(s => s.changePercent < 0).length}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-slate-900 rounded-xl p-4 border border-cyan-800/30">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-cyan-600/20 flex items-center justify-center">
                        <Star className="h-5 w-5 text-cyan-400" />
                      </div>
                      <div>
                        <p className="text-sm text-slate-400">Takibim</p>
                        <p className="text-2xl font-bold text-white">{watchlist.length}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Main Grid */}
                <div className="grid lg:grid-cols-2 gap-6">
                  {/* Top Gainers */}
                  <SectionCard
                    title="En Çok Kazandıranlar"
                    icon={TrendingUp}
                    color="text-emerald-400"
                    onSeeAll={() => setActiveTab('gainers')}
                  >
                    {topGainers.length > 0 ? topGainers.slice(0, 5).map((stock) => (
                      <StockCard key={stock.code} stock={stock} />
                    )) : (
                      <div className="p-8 text-center text-slate-500">
                        Veri yükleniyor...
                      </div>
                    )}
                  </SectionCard>

                  {/* Top Losers */}
                  <SectionCard
                    title="En Çok Kaybettirenler"
                    icon={TrendingDown}
                    color="text-red-400"
                    onSeeAll={() => setActiveTab('losers')}
                  >
                    {topLosers.length > 0 ? topLosers.slice(0, 5).map((stock) => (
                      <StockCard key={stock.code} stock={stock} />
                    )) : (
                      <div className="p-8 text-center text-slate-500">
                        Veri yükleniyor...
                      </div>
                    )}
                  </SectionCard>

                  {/* AI Agent CTA */}
                  <div className="lg:col-span-2">
                    <Card className="bg-gradient-to-r from-emerald-900/50 to-cyan-900/50 border-emerald-800/50">
                      <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
                              <Bot className="h-7 w-7 text-white" />
                            </div>
                            <div>
                              <h3 className="text-lg font-semibold text-white">AI Yatırım Asistanı</h3>
                              <p className="text-slate-400">Hisse analizi, tahmin ve yatırım önerileri için sorularınızı sorun</p>
                            </div>
                          </div>
                          <Button
                            onClick={() => setAgentOpen(true)}
                            className="bg-gradient-to-r from-emerald-600 to-cyan-600 hover:opacity-90"
                          >
                            <Sparkles className="h-4 w-4 mr-2" />
                            Sohbete Başla
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            )}

            {/* Stocks Tab */}
            {activeTab === 'stocks' && (
              <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <Database className="h-5 w-5 text-slate-400" />
                    Tüm Hisseler
                    <Badge variant="secondary" className="bg-slate-700">{filteredStocks.length}</Badge>
                  </h3>
                </div>
                <ScrollArea className="h-[calc(100vh-300px)]">
                  {filteredStocks.map((stock) => (
                    <StockCard key={stock.code} stock={stock} />
                  ))}
                </ScrollArea>
              </div>
            )}

            {/* Watchlist Tab */}
            {activeTab === 'watchlist' && (
              <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                <div className="p-4 border-b border-slate-800">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <Star className="h-5 w-5 text-yellow-400" />
                    Takip Listem
                    <Badge variant="secondary" className="bg-slate-700">{watchlist.length}</Badge>
                  </h3>
                </div>
                {watchlist.length > 0 ? (
                  watchlist.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 hover:bg-slate-800/50 cursor-pointer border-b border-slate-800 last:border-0"
                      onClick={() => openStockDetail({ code: item.symbol, name: item.name, price: item.currentPrice || 0, change: item.change || 0, changePercent: item.changePercent || 0, volume: 0, high: 0, low: 0, open: 0, previousClose: 0 })}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${(item.changePercent || 0) > 0 ? 'bg-emerald-600/20 text-emerald-400' : 'bg-red-600/20 text-red-400'}`}>
                          {item.symbol.slice(0, 2)}
                        </div>
                        <div>
                          <p className="font-medium text-white">{item.symbol}</p>
                          <p className="text-xs text-slate-500">{item.name}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="font-medium text-white">{formatNumber(item.currentPrice || 0)} ₺</p>
                          <p className={`text-sm ${(item.changePercent || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {(item.changePercent || 0) >= 0 ? '+' : ''}{formatNumber(item.changePercent || 0)}%
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromWatchlist(item.symbol);
                          }}
                          className="p-2 rounded-lg text-red-400 hover:bg-red-400/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center">
                    <Star className="h-12 w-12 text-slate-700 mx-auto mb-4" />
                    <p className="text-slate-500">Takip listesi boş</p>
                    <p className="text-slate-600 text-sm mt-2">Hisseler sayfasından hisse ekleyebilirsiniz</p>
                  </div>
                )}
              </div>
            )}

            {/* Gainers Tab */}
            {activeTab === 'gainers' && (
              <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                <div className="p-4 border-b border-slate-800">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-emerald-400" />
                    En Çok Yükselenler
                  </h3>
                </div>
                <ScrollArea className="h-[calc(100vh-300px)]">
                  {stocks.sort((a, b) => b.changePercent - a.changePercent).slice(0, 50).map((stock) => (
                    <StockCard key={stock.code} stock={stock} />
                  ))}
                </ScrollArea>
              </div>
            )}

            {/* Losers Tab */}
            {activeTab === 'losers' && (
              <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                <div className="p-4 border-b border-slate-800">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <TrendingDown className="h-5 w-5 text-red-400" />
                    En Çok Düşenler
                  </h3>
                </div>
                <ScrollArea className="h-[calc(100vh-300px)]">
                  {stocks.sort((a, b) => a.changePercent - b.changePercent).slice(0, 50).map((stock) => (
                    <StockCard key={stock.code} stock={stock} />
                  ))}
                </ScrollArea>
              </div>
            )}

            {/* Alerts Tab */}
            {activeTab === 'alerts' && (
              <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                <div className="p-4 border-b border-slate-800">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <Bell className="h-5 w-5 text-amber-400" />
                    Fiyat Bildirimlerim
                    <Badge variant="secondary" className="bg-slate-700">{alerts.length}</Badge>
                  </h3>
                </div>
                {alerts.length > 0 ? (
                  alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-center justify-between p-3 hover:bg-slate-800/50 border-b border-slate-800 last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${alert.condition === 'above' ? 'bg-emerald-600/20 text-emerald-400' : 'bg-red-600/20 text-red-400'}`}>
                          {alert.condition === 'above' ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
                        </div>
                        <div>
                          <p className="font-medium text-white">{alert.symbol}</p>
                          <p className="text-xs text-slate-500">
                            {alert.targetPrice} ₺ {alert.condition === 'above' ? 'üzerine çıkınca' : 'altına inince'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm text-slate-400">Güncel: {formatNumber(alert.currentPrice || 0)} ₺</p>
                          <p className="text-xs text-slate-500">Fark: {alert.distance}%</p>
                        </div>
                        <button
                          onClick={async () => {
                            await fetch(`/api/alerts?id=${alert.id}`, { method: 'DELETE' });
                            setAlerts(prev => prev.filter(a => a.id !== alert.id));
                            toast({ title: 'Bildirim silindi' });
                          }}
                          className="p-2 rounded-lg text-red-400 hover:bg-red-400/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-12 text-center">
                    <Bell className="h-12 w-12 text-slate-700 mx-auto mb-4" />
                    <p className="text-slate-500">Henüz bildirim yok</p>
                    <p className="text-slate-600 text-sm mt-2">AI Asistan ile "X hissesi Y lira olunca bildir" diyebilirsiniz</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Stock Detail Modal */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {selectedStock && (
                <>
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${selectedStock.changePercent > 0 ? 'bg-emerald-600/20 text-emerald-400' : 'bg-red-600/20 text-red-400'}`}>
                    {selectedStock.code.slice(0, 2)}
                  </div>
                  <div>
                    <p>{selectedStock.code}</p>
                    <p className="text-sm text-slate-500 font-normal">{selectedStock.name}</p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-lg font-bold">{formatNumber(selectedStock.price)} ₺</p>
                    <p className={`text-sm ${selectedStock.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {selectedStock.changePercent >= 0 ? '+' : ''}{formatNumber(selectedStock.changePercent)}%
                    </p>
                  </div>
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Timeframe Buttons */}
          <div className="flex gap-2 mb-4">
            {['1M', '3M', '6M', '1Y'].map((tf) => (
              <Button
                key={tf}
                variant={chartTimeframe === tf ? 'default' : 'outline'}
                size="sm"
                onClick={() => fetchHistoricalData(tf)}
                className={chartTimeframe === tf ? 'bg-emerald-600' : 'border-slate-700 text-slate-400'}
              >
                {tf}
              </Button>
            ))}
          </div>

          {/* Chart */}
          {detailLoading ? (
            <div className="h-[300px] flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            </div>
          ) : historicalData.length > 0 ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historicalData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="date"
                    stroke="#64748b"
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    tickFormatter={(v) => v.slice(5)}
                  />
                  <YAxis
                    stroke="#64748b"
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '8px'
                    }}
                    labelStyle={{ color: '#fff' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="close"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-slate-500">
              Grafik verisi yok
            </div>
          )}

          {/* Indicators */}
          {indicators && (
            <div className="grid grid-cols-4 gap-4 mt-4">
              <div className="bg-slate-800 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-500">SMA 20</p>
                <p className="font-medium text-white">{indicators.sma20 ? formatNumber(indicators.sma20) : '-'}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-500">SMA 50</p>
                <p className="font-medium text-white">{indicators.sma50 ? formatNumber(indicators.sma50) : '-'}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-500">RSI</p>
                <p className="font-medium text-white">{indicators.rsi ? formatNumber(indicators.rsi) : '-'}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-500">Trend</p>
                <p className={`font-medium ${trend === 'BULLISH' ? 'text-emerald-400' : trend === 'BEARISH' ? 'text-red-400' : 'text-slate-400'}`}>
                  {trend === 'BULLISH' ? '↑ Yükseliş' : trend === 'BEARISH' ? '↓ Düşüş' : '→ Yatay'}
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              className="flex-1 border-slate-700"
              onClick={() => {
                if (selectedStock) {
                  if (isInWatchlist(selectedStock.code)) {
                    removeFromWatchlist(selectedStock.code);
                  } else {
                    addToWatchlist(selectedStock);
                  }
                }
              }}
            >
              {selectedStock && isInWatchlist(selectedStock.code) ? (
                <>
                  <StarOff className="h-4 w-4 mr-2" />
                  Takipten Çıkar
                </>
              ) : (
                <>
                  <Star className="h-4 w-4 mr-2" />
                  Takibe Al
                </>
              )}
            </Button>
            <Button
              className="flex-1 bg-gradient-to-r from-emerald-600 to-cyan-600"
              onClick={() => {
                setDetailOpen(false);
                setAgentOpen(true);
                if (selectedStock) {
                  setChatInput(`${selectedStock.code} hissesi analizi, ne yapmalıyım?`);
                }
              }}
            >
              <Bot className="h-4 w-4 mr-2" />
              AI Analizi
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Agent Dialog */}
      <Dialog open={agentOpen} onOpenChange={setAgentOpen}>
        <DialogContent className="max-w-3xl h-[80vh] bg-slate-900 border-slate-800 flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-6 w-6 text-emerald-400" />
              AI Yatırım Asistanı
              <Badge variant="outline" className="ml-2 border-emerald-600 text-emerald-400">
                <Zap className="h-3 w-3 mr-1" />
                15 Araç
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {/* Tool Progress */}
          {toolProgress.length > 0 && (
            <div className="bg-slate-800 rounded-lg p-3 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                <span className="text-sm text-slate-400">Analiz yapılıyor...</span>
              </div>
              <div className="space-y-1">
                {toolProgress.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {p.status === 'running' && <Loader2 className="h-3 w-3 animate-spin text-yellow-400" />}
                    {p.status === 'completed' && <CheckCircle className="h-3 w-3 text-emerald-400" />}
                    {p.status === 'pending' && <Clock className="h-3 w-3 text-slate-500" />}
                    <span className={p.status === 'completed' ? 'text-slate-500' : 'text-slate-400'}>{p.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chat Messages */}
          <ScrollArea className="flex-1 pr-4">
            {chatMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <Bot className="h-16 w-16 text-slate-700 mb-4" />
                <p className="text-slate-500 mb-4">Merhaba! Size nasıl yardımcı olabilirim?</p>
                <div className="grid grid-cols-1 gap-2 w-full max-w-md">
                  {[
                    'THYAO hissesi analizi, ne yapmalıyım?',
                    '50.000 liram var, nereye yatırım yapmalıyım?',
                    'Bugün en çok yükselen hisseler hangileri?',
                    'ASELS hissesini satmalı mıyım?'
                  ].map((q, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setChatInput(q);
                        setTimeout(() => sendToAgent(), 100);
                      }}
                      className="text-left p-3 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm text-slate-300 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {chatMessages.map((msg, idx) => (
                  <div key={msg.id} className={`${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                    {/* Tool Badges */}
                    {msg.role === 'assistant' && msg.toolsUsed && msg.toolsUsed.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {msg.toolsUsed.map((tool) => {
                          const toolInfo = TOOLS.find(t => t.id === tool);
                          if (!toolInfo) return null;
                          const Icon = toolInfo.icon;
                          return (
                            <Badge key={tool} variant="outline" className={`${toolInfo.color} border-current text-xs`}>
                              <Icon className="h-3 w-3 mr-1" />
                              {toolInfo.name}
                            </Badge>
                          );
                        })}
                      </div>
                    )}

                    {/* Message Content */}
                    <div className={`inline-block max-w-[85%] p-3 rounded-lg ${msg.role === 'user'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-200'
                      }`}>
                      <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                    </div>

                    {/* Pending Actions */}
                    {msg.pendingActions && msg.pendingActions.length > 0 && (
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => confirmPendingActions(msg.pendingActions!, idx)}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Onayla
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-600 text-red-400 hover:bg-red-600/10"
                          onClick={() => cancelPendingActions(idx)}
                        >
                          <X className="h-4 w-4 mr-1" />
                          İptal
                        </Button>
                      </div>
                    )}

                    {/* Suggested Questions */}
                    {msg.suggestedQuestions && msg.suggestedQuestions.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {msg.suggestedQuestions.map((q, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              setChatInput(q);
                              setTimeout(() => sendToAgent(), 100);
                            }}
                            className="block text-left text-xs text-emerald-400 hover:text-emerald-300"
                          >
                            → {q}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {chatLoading && (
                  <div className="text-left">
                    <div className="inline-block p-3 rounded-lg bg-slate-800">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}
          </ScrollArea>

          {/* Input Area */}
          <div className="flex gap-2 mt-4 pt-4 border-t border-slate-800">
            <input
              type="file"
              ref={txtInputRef}
              accept=".txt"
              onChange={handleTxtUpload}
              className="hidden"
            />
            <input
              type="file"
              ref={imageInputRef}
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => txtInputRef.current?.click()}
              className="text-slate-400 hover:text-white"
            >
              <FileText className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => imageInputRef.current?.click()}
              className="text-slate-400 hover:text-white"
            >
              <ImageIcon className="h-5 w-5" />
            </Button>
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendToAgent()}
              placeholder="Mesajınızı yazın... (örn: THYAO ne olur?)"
              className="flex-1 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
            <Button
              onClick={sendToAgent}
              disabled={chatLoading || !chatInput.trim()}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Auth Dialog */}
      <Dialog open={authOpen} onOpenChange={setAuthOpen}>
        <DialogContent className="max-w-md bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-emerald-400" />
              {authMode === 'login' ? 'Giriş Yap' : 'Kayıt Ol'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm text-slate-400 mb-1 block">Rumuz</label>
              <Input
                value={rumuzInput}
                onChange={(e) => setRumuzInput(e.target.value)}
                placeholder="kullanici_adi"
                className="bg-slate-800 border-slate-700 text-white"
                onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
              />
            </div>

            <Button
              onClick={handleAuth}
              disabled={authLoading || !rumuzInput.trim()}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
            >
              {authLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : authMode === 'login' ? (
                'Giriş Yap'
              ) : (
                'Kayıt Ol'
              )}
            </Button>

            <button
              onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              className="w-full text-center text-sm text-slate-400 hover:text-white"
            >
              {authMode === 'login' ? 'Hesabınız yok mu? Kayıt olun' : 'Zaten hesabınız var mı? Giriş yapın'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
