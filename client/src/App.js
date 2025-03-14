// App.js - Enhanced React component for Brawl Stars Content Navigator

import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { 
  Search, Send, Mic, Smile, Filter, X, ChevronLeft, 
  ThumbsUp, ThumbsDown, Moon, Sun, Settings, Share, 
  ExternalLink, Grid, List, RefreshCw, Clock, Eye, 
  Calendar, User, AlertTriangle, InfoIcon, CheckCircle
} from 'lucide-react';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import { motion, AnimatePresence } from 'framer-motion';
import { debounce } from 'lodash';
import './App.css';
import { mockFilters, mockRecommendations, mockConversationResponse } from './mockData';

// API base URL - replace with your deployed API URL
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';

// Create axios instance with interceptors for error handling and monitoring
const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: false,
  timeout: 15000 // 15 seconds timeout
});

// Add request/response interceptors
api.interceptors.request.use(
  config => {
    // Add timestamp to track request duration
    config.metadata = { startTime: new Date() };
    return config;
  },
  error => Promise.reject(error)
);

api.interceptors.response.use(
  response => {
    // Calculate request duration
    const duration = new Date() - response.config.metadata.startTime;
    console.log(`${response.config.url} completed in ${duration}ms`);
    return response;
  },
  error => {
    // Handle common errors
    if (error.response) {
      // Server responded with error status
      console.error('Response error:', error.response.status, error.response.data);
    } else if (error.request) {
      // Request made but no response received
      console.error('Network error:', error.request);
    } else {
      // Something else happened
      console.error('Error:', error.message);
    }
    return Promise.reject(error);
  }
);

function App() {
  // State for messages and user interface
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [themeMode, setThemeMode] = useState(() => {
    return localStorage.getItem('themeMode') || 'light';
  });
  
  // State for filters and UI
  const [filters, setFilters] = useState({
    brawlers: [],
    gameModes: [],
    contentTypes: [],
    skillLevels: [],
    sortOptions: []
  });
  const [activeFilters, setActiveFilters] = useState({
    brawlers: [],
    gameModes: [],
    contentTypes: [],
    skillLevel: '',
    sortBy: 'relevance',
    minViews: 0,
    maxDuration: 0
  });
  const [showFilters, setShowFilters] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('viewMode') || 'grid';
  });
  
  // State for user preferences and user experience
  const [userPreferences, setUserPreferences] = useState({
    preferredBrawlers: [],
    preferredGameModes: [],
    preferredContentTypes: []
  });
  const [videoDetails, setVideoDetails] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [trendingBrawlers, setTrendingBrawlers] = useState([]);
  const [popularQueries, setPopularQueries] = useState([]);
  const [pagination, setPagination] = useState({
    current: 1,
    total: 1,
    limit: 12
  });
  const [toasts, setToasts] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [processingMetrics, setProcessingMetrics] = useState(null);
  
  // Refs
  const messagesEndRef = useRef(null);
  const videoPlayerRef = useRef(null);
  const searchInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  
  // Toggle theme mode
  const toggleTheme = () => {
    const newTheme = themeMode === 'light' ? 'dark' : 'light';
    setThemeMode(newTheme);
    localStorage.setItem('themeMode', newTheme);
    
    // Apply dark theme class to body
    if (newTheme === 'dark') {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  };
  
  // Toggle view mode
  const toggleViewMode = () => {
    const newViewMode = viewMode === 'grid' ? 'list' : 'grid';
    setViewMode(newViewMode);
    localStorage.setItem('viewMode', newViewMode);
  };
  
  // Initialize theme on component mount
  useEffect(() => {
    if (themeMode === 'dark') {
      document.body.classList.add('dark-theme');
    }
  }, [themeMode]);
  
  // Fetch filters, user preferences, and recommendations on component mount
  useEffect(() => {
    fetchFilters();
    fetchUserPreferences();
    
    if (initialLoad) {
      fetchRecommendations();
      setInitialLoad(false);
    }
    
    // Add welcome message
    setMessages([{
      role: 'assistant',
      content: "Hi there! I'm your Brawl Stars Content Navigator. Ask me to find videos about any brawler, game mode, or type of content you're interested in!",
      timestamp: new Date().toISOString()
    }]);
    
    // Initialize speech recognition if available
    initSpeechRecognition();
    
  }, []);
  
  // Scroll to bottom of messages
  useEffect(() => {
    scrollToBottom();
  }, [messages]);
  
  // Initialize speech recognition
  const initSpeechRecognition = () => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      console.log('Voice input is supported');
    } else {
      console.log('Voice input is not supported in this browser');
    }
  };
  
  // Start recording audio
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        sendAudioToServer(audioBlob);
      };
      
      mediaRecorderRef.current.start();
      setIsRecording(true);
      showToast('Recording...', 'info');
    } catch (error) {
      console.error('Error accessing microphone:', error);
      showToast('Could not access microphone', 'error');
    }
  };
  
  // Stop recording audio
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      // Stop all audio tracks
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };
  
  // Send audio to server or use Web Speech API for speech-to-text
  const sendAudioToServer = async (audioBlob) => {
    // Here you would typically send the audio to a speech-to-text service
    // For this implementation, we'll use the Web Speech API if available
    
    if (window.webkitSpeechRecognition) {
      const recognition = new window.webkitSpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
      };
      
      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        showToast('Speech recognition failed', 'error');
      };
      
      recognition.start();
    } else {
      showToast('Speech recognition not supported in this browser', 'warning');
      // Fallback: You could upload the audio to a server endpoint
      // that handles speech-to-text conversion
    }
  };
  
  // Fetch available filters
 const fetchFilters = async () => {
  try {
    const response = await api.get('/filters');
    setFilters(response.data);
  } catch (error) {
    console.error('Error fetching filters:', error);
    // Use mock data as fallback
    setFilters(mockFilters);
    showToast('Using local data', 'info');
  }
};
  
  // Fetch user preferences
  const fetchUserPreferences = async () => {
    try {
      const response = await api.get('/preferences');
      setUserPreferences(response.data);
    } catch (error) {
      console.error('Error fetching user preferences:', error);
      // Non-critical error, so no toast
    }
  };
  
  // Fetch personalized recommendations
  const fetchRecommendations = async () => {
  try {
    setLoading(true);
    const response = await api.get('/recommendations');
    setRecommendations(response.data.videos || []);
    setTrendingBrawlers(response.data.trendingBrawlers || []);
    setPopularQueries(response.data.popularQueries || []);
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    // Use mock data as fallback
    setRecommendations(mockRecommendations.videos || []);
    setTrendingBrawlers(mockRecommendations.trendingBrawlers || []);
    setPopularQueries(mockRecommendations.popularQueries || []);
    showToast('Using local recommendations', 'info');
  } finally {
    setLoading(false);
  }
};
  
  // Handle sending a message
const handleSendMessage = async (e) => {
  e?.preventDefault();
  
  if (!input.trim()) return;
  
  // Add user message to chat
  const userMessage = {
    role: 'user',
    content: input,
    timestamp: new Date().toISOString()
  };
  
  setMessages(prev => [...prev, userMessage]);
  setInput('');
  setLoading(true);
  
  try {
    // Send message to API
    const response = await api.post('/conversation', {
      message: userMessage.content
    });
    
    // Add assistant message to chat
    const assistantMessage = {
      role: 'assistant',
      content: response.data.message,
      timestamp: new Date().toISOString(),
      suggestedActions: response.data.suggestedActions || []
    };
    
    setMessages(prev => [...prev, assistantMessage]);
    
    // Update search results
    setSearchResults(response.data.results || []);
    
    // Update pagination
    if (response.data.pagination) {
      setPagination({
        current: response.data.pagination.page,
        total: response.data.pagination.pages,
        limit: response.data.pagination.limit
      });
    }
    
    // Update processing metrics
    if (response.data.metrics) {
      setProcessingMetrics(response.data.metrics);
    }
    
    // Update user preferences
    fetchUserPreferences();
  } catch (error) {
    console.error('Error sending message:', error);
    // Use mock data as fallback
    const mockResponse = mockConversationResponse;
    
    const assistantMessage = {
      role: 'assistant',
      content: mockResponse.message,
      timestamp: new Date().toISOString(),
      suggestedActions: mockResponse.suggestedActions || []
    };
    
    setMessages(prev => [...prev, assistantMessage]);
    setSearchResults(mockResponse.results || []);
    
    if (mockResponse.pagination) {
      setPagination({
        current: mockResponse.pagination.page,
        total: mockResponse.pagination.pages,
        limit: mockResponse.pagination.limit
      });
    }
    
    setProcessingMetrics(mockResponse.metrics);
    showToast('Using local data for conversation', 'info');
  } finally {
    setLoading(false);
  }
};
  
  // Handle suggested action click
  const handleSuggestedAction = async (action) => {
    if (action.type === 'refine_search') {
      // Update active filters with the suggested parameters
      setActiveFilters(prev => ({
        ...prev,
        ...action.parameters
      }));
      
      // Send the suggested action as a message
      const message = action.label || 'Show me these results';
      
      // Add user message to chat
      const userMessage = {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      };
      
      setMessages(prev => [...prev, userMessage]);
      setLoading(true);
      
      try {
        // Send message to API
        const response = await api.post('/conversation', {
          message: message
        });
        
        // Add assistant message to chat
        const assistantMessage = {
          role: 'assistant',
          content: response.data.message,
          timestamp: new Date().toISOString(),
          suggestedActions: response.data.suggestedActions || []
        };
        
        setMessages(prev => [...prev, assistantMessage]);
        
        // Update search results
        setSearchResults(response.data.results || []);
        
        // Update pagination
        if (response.data.pagination) {
          setPagination({
            current: response.data.pagination.page,
            total: response.data.pagination.pages,
            limit: response.data.pagination.limit
          });
        }
      } catch (error) {
        console.error('Error with suggested action:', error);
        // Add error message
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: "Sorry, I couldn't process that action. Please try a different query.",
          timestamp: new Date().toISOString(),
          error: true
        }]);
        
        showToast('Failed to process action', 'error');
      } finally {
        setLoading(false);
      }
    } else if (action.type === 'filter_by_mode') {
      // Set active filters for game mode
      setActiveFilters(prev => ({
        ...prev,
        gameModes: action.parameters.gameModes || []
      }));
      
      // Trigger a search with these filters
      handleFilterSearch();
    } else if (action.type === 'play_video') {
      // Load video details and play
      fetchVideoDetails(action.parameters.youtubeId);
    }
  };
  
  // Handle direct search using filters
  const handleFilterSearch = async () => {
    setLoading(true);
    
    try {
      // Convert active filters to query parameters
      const params = {
        brawlers: activeFilters.brawlers,
        gameModes: activeFilters.gameModes,
        contentType: activeFilters.contentTypes,
        skillLevel: activeFilters.skillLevel,
        sortBy: activeFilters.sortBy,
        minViews: activeFilters.minViews,
        maxDuration: activeFilters.maxDuration,
        page: 1,
        limit: pagination.limit
      };
      
      const response = await api.get('/search', { params });
      
      // Update search results
      setSearchResults(response.data.videos || []);
      
      // Update pagination
      if (response.data.pagination) {
        setPagination({
          current: response.data.pagination.page,
          total: response.data.pagination.pages,
          limit: response.data.pagination.limit
        });
      }
      
      // Update messages
      const filterDescription = getFilterDescription();
      const userMessage = {
        role: 'user',
        content: `Search for ${filterDescription}`,
        timestamp: new Date().toISOString()
      };
      
      const assistantMessage = {
        role: 'assistant',
        content: `Here are the results for ${filterDescription}. I found ${response.data.videos.length} videos that match your criteria.`,
        timestamp: new Date().toISOString()
      };
      
      setMessages(prev => [...prev, userMessage, assistantMessage]);
      
      // Close filter sidebar on mobile
      if (window.innerWidth <= 768) {
        setShowFilters(false);
      }
      
      showToast('Search results updated', 'success');
    } catch (error) {
      console.error('Error with filter search:', error);
      // Add error message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Sorry, I couldn't find videos with those filters. Please try different criteria.",
        timestamp: new Date().toISOString(),
        error: true
      }]);
      
      showToast('Search failed', 'error');
    } finally {
      setLoading(false);
    }
  };
  
  // Handle pagination
  const handlePageChange = async (newPage) => {
    if (newPage === pagination.current) return;
    
    setLoading(true);
    
    try {
      // Convert active filters to query parameters
      const params = {
        brawlers: activeFilters.brawlers,
        gameModes: activeFilters.gameModes,
        contentType: activeFilters.contentTypes,
        skillLevel: activeFilters.skillLevel,
        sortBy: activeFilters.sortBy,
        minViews: activeFilters.minViews,
        maxDuration: activeFilters.maxDuration,
        page: newPage,
        limit: pagination.limit
      };
      
      const response = await api.get('/search', { params });
      
      // Update search results
      setSearchResults(response.data.videos || []);
      
      // Update pagination
      if (response.data.pagination) {
        setPagination({
          current: response.data.pagination.page,
          total: response.data.pagination.pages,
          limit: response.data.pagination.limit
        });
      }
      
      // Scroll to search results
      document.querySelector('.search-results')?.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
      console.error('Error changing page:', error);
      showToast('Failed to load page', 'error');
    } finally {
      setLoading(false);
    }
  };
  
  // Get a description of the current filters
  const getFilterDescription = () => {
    const parts = [];
    
    if (activeFilters.brawlers && activeFilters.brawlers.length > 0) {
      parts.push(`brawlers: ${activeFilters.brawlers.join(', ')}`);
    }
    
    if (activeFilters.gameModes && activeFilters.gameModes.length > 0) {
      parts.push(`game modes: ${activeFilters.gameModes.join(', ')}`);
    }
    
    if (activeFilters.contentTypes && activeFilters.contentTypes.length > 0) {
      parts.push(`content types: ${activeFilters.contentTypes.join(', ')}`);
    }
    
    if (activeFilters.skillLevel) {
      parts.push(`skill level: ${activeFilters.skillLevel}`);
    }
    
    if (activeFilters.minViews > 0) {
      parts.push(`min views: ${formatNumber(activeFilters.minViews)}`);
    }
    
    if (activeFilters.maxDuration > 0) {
      parts.push(`max duration: ${formatDuration(activeFilters.maxDuration)}`);
    }
    
    return parts.length > 0 ? parts.join(', ') : 'all Brawl Stars content';
  };
  
  // Fetch video details
  const fetchVideoDetails = async (youtubeId) => {
    try {
      setLoading(true);
      const response = await api.get(`/videos/${youtubeId}`);
      setVideoDetails(response.data.video);
      
      // Scroll to top when viewing video details
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error('Error fetching video details:', error);
      showToast('Failed to load video details', 'error');
    } finally {
      setLoading(false);
    }
  };
  
  // Submit feedback for a video
  const submitFeedback = async (youtubeId, feedbackType, comment = null) => {
    try {
      await api.post('/feedback', {
        youtubeId,
        feedbackType,
        comment
      });
      
      // Add thank you message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Thanks for your feedback! This helps me improve my recommendations.",
        timestamp: new Date().toISOString()
      }]);
      
      showToast('Feedback submitted successfully', 'success');
    } catch (error) {
      console.error('Error submitting feedback:', error);
      showToast('Failed to submit feedback', 'error');
    }
  };
  
  // Share a video
  const shareVideo = async (video) => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: video.title,
          text: `Check out this Brawl Stars video: ${video.title}`,
          url: `https://www.youtube.com/watch?v=${video.youtubeId}`
        });
        showToast('Video shared successfully', 'success');
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Error sharing video:', error);
          showToast('Failed to share video', 'error');
        }
      }
    } else {
      // Fallback: Copy link to clipboard
      try {
        await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${video.youtubeId}`);
        showToast('Link copied to clipboard', 'success');
      } catch (error) {
        console.error('Error copying to clipboard:', error);
        showToast('Failed to copy link', 'error');
      }
    }
  };
  
  // Clear conversation history
  const clearConversation = async () => {
    try {
      await api.delete('/conversation/history');
      
      // Reset messages to just a welcome message
      setMessages([{
        role: 'assistant',
        content: "I've cleared our conversation. What would you like to chat about now?",
        timestamp: new Date().toISOString()
      }]);
      
      // Clear search results and video details
      setSearchResults([]);
      setVideoDetails(null);
      
      showToast('Conversation history cleared', 'success');
    } catch (error) {
      console.error('Error clearing conversation:', error);
      showToast('Failed to clear conversation', 'error');
    }
  };
  
  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  
  // Toggle filter visibility
  const toggleFilters = () => {
    setShowFilters(!showFilters);
  };
  
  // Handle filter changes
  const handleFilterChange = (filterType, value) => {
    setActiveFilters(prev => {
      // If the value is already selected, remove it
      if (Array.isArray(prev[filterType]) && prev[filterType].includes(value)) {
        return {
          ...prev,
          [filterType]: prev[filterType].filter(item => item !== value)
        };
      }
      
      // For single-value filters (like skillLevel, sortBy)
      if (!Array.isArray(prev[filterType])) {
        return {
          ...prev,
          [filterType]: value
        };
      }
      
      // For multi-value filters (like brawlers, gameModes)
      return {
        ...prev,
        [filterType]: [...prev[filterType], value]
      };
    });
  };
  
  // Handle filter search input change
  const handleFilterSearchChange = (e) => {
    setFilterSearch(e.target.value);
  };
  
  // Filter items based on search input
  const filterItems = (items) => {
    if (!filterSearch) return items;
    
    return items.filter(item => 
      item.name.toLowerCase().includes(filterSearch.toLowerCase())
    );
  };
  
  // Clear all active filters
  const clearFilters = () => {
    setActiveFilters({
      brawlers: [],
      gameModes: [],
      contentTypes: [],
      skillLevel: '',
      sortBy: 'relevance',
      minViews: 0,
      maxDuration: 0
    });
    setFilterSearch('');
  };
  
  // Handle input change with debouncing for performance
  const handleInputChange = (e) => {
    setInput(e.target.value);
  };
  
  // Show toast notification
  const showToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, 3000);
  };
  
  // Handle toast removal
  const removeToast = (id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };
  
  // Format duration (seconds to MM:SS)
  const formatDuration = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    if (minutes < 60) {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  };
  
  // Format view count (e.g., 1.2M, 456K)
  const formatNumber = (count) => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };
  
  // Format date (relative to now)
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else if (diffDays < 30) {
      return `${Math.floor(diffDays / 7)} weeks ago`;
    } else if (diffDays < 365) {
      return `${Math.floor(diffDays / 30)} months ago`;
    } else {
      return `${Math.floor(diffDays / 365)} years ago`;
    }
  };
  
  // Render a message
  const renderMessage = (message, index) => {
    return (
      <motion.div
        key={index}
        className={`message ${message.role} ${message.error ? 'error' : ''}`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="message-header">
          <div className="message-avatar">
            {message.role === 'user' ? (
              <User size={16} />
            ) : (
              <img src="/logo-small.png" alt="Assistant" />
            )}
          </div>
          <div className="message-sender">
            {message.role === 'user' ? 'You' : 'Brawl Navigator'}
          </div>
        </div>
        
        <div className="message-content">
          {message.content}
          
          {processingMetrics && index === messages.length - 1 && message.role === 'assistant' && (
            <div className="processing-metrics">
              <small className="text-muted">
                (Generated in {processingMetrics.totalTime}ms)
              </small>
            </div>
          )}
        </div>
        
        {message.suggestedActions && message.suggestedActions.length > 0 && (
          <div className="suggested-actions">
            {message.suggestedActions.map((action, actionIndex) => (
              <button
                key={actionIndex}
                className="suggested-action-btn"
                onClick={() => handleSuggestedAction(action)}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        
        <div className="message-timestamp">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </motion.div>
    );
  };
  
  // Render a video card
  const renderVideoCard = (video) => {
    return (
      <div key={video.youtubeId} className="video-card" onClick={() => fetchVideoDetails(video.youtubeId)}>
        <div className="video-thumbnail">
          <img 
            src={`https://img.youtube.com/vi/${video.youtubeId}/mqdefault.jpg`} 
            alt={video.title}
            loading="lazy"
          />
          <div className="video-duration">{formatDuration(video.duration)}</div>
        </div>
        
        <div className="video-info">
          <h3 className="video-title">{video.title}</h3>
          
          <div className="video-channel">
            <User size={14} />
            {video.creator.name}
          </div>
          
          <div className="video-meta">
            <div className="video-views">
              <Eye size={14} />
              {formatNumber(video.viewCount)} views
            </div>
            
            <div className="video-published">
              <Clock size={14} />
              {formatDate(video.publishedAt)}
            </div>
          </div>
          
          <div className="video-tags">
            {video.brawlers && video.brawlers.slice(0, 2).map((brawler, index) => (
              <span key={`brawler-${index}`} className="video-tag brawler">{brawler}</span>
            ))}
            
            {video.gameModes && video.gameModes.slice(0, 1).map((mode, index) => (
              <span key={`mode-${index}`} className="video-tag mode">{mode}</span>
            ))}
            
            {video.contentType && video.contentType.slice(0, 1).map((type, index) => (
              <span key={`type-${index}`} className="video-tag content-type">{type}</span>
            ))}
          </div>
        </div>
      </div>
    );
  };
  
  // Render pagination controls
  const renderPagination = () => {
    if (pagination.total <= 1) return null;
    
    const buttons = [];
    const maxButtons = 5;
    
    // Previous button
    buttons.push(
      <button
        key="prev"
        className="pagination-btn"
        onClick={() => handlePageChange(pagination.current - 1)}
        disabled={pagination.current === 1}
      >
        &lt;
      </button>
    );
    
    // Calculate range of pages to show
    let startPage = Math.max(1, pagination.current - Math.floor(maxButtons / 2));
    let endPage = Math.min(pagination.total, startPage + maxButtons - 1);
    
    // Adjust if at the end
    if (endPage - startPage < maxButtons - 1 && startPage > 1) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }
    
    // Page buttons
    for (let i = startPage; i <= endPage; i++) {
      buttons.push(
        <button
          key={i}
          className={`pagination-btn ${pagination.current === i ? 'active' : ''}`}
          onClick={() => handlePageChange(i)}
        >
          {i}
        </button>
      );
    }
    
    // Next button
    buttons.push(
      <button
        key="next"
        className="pagination-btn"
        onClick={() => handlePageChange(pagination.current + 1)}
        disabled={pagination.current === pagination.total}
      >
        &gt;
      </button>
    );
    
    return (
      <div className="pagination">
        {buttons}
      </div>
    );
  };
  
  // Render toast notifications
  const renderToasts = () => {
    return (
      <div className="toast-container">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              className={`toast ${toast.type}`}
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 100 }}
              onClick={() => removeToast(toast.id)}
            >
              {toast.type === 'success' && <CheckCircle size={16} />}
              {toast.type === 'error' && <AlertTriangle size={16} />}
              {toast.type === 'info' && <InfoIcon size={16} />}
              {toast.type === 'warning' && <AlertTriangle size={16} />}
              <span>{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    );
  };
  
  // Render empty state when no results
  const renderEmptyState = () => {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🔍</div>
        <h3>No videos found</h3>
        <p>Try adjusting your search filters or try a different search term.</p>
        <button onClick={clearFilters} className="clear-filters-btn">
          Clear All Filters
        </button>
        
        {popularQueries.length > 0 && (
          <>
            <p>Or try one of these popular searches:</p>
            <div className="suggestions">
              {popularQueries.slice(0, 5).map((query, index) => (
                <button
                  key={index}
                  className="suggestion-btn"
                  onClick={() => {
                    setInput(query.query);
                    handleSendMessage();
                  }}
                >
                  {query.query}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };
  
  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">
          <img src="/logo.png" alt="Brawl Stars Content Navigator" />
          <h1>Brawl Stars Content</h1>
        </div>
        
        <div className="header-actions">
          <Tippy content="Toggle Filters">
            <button onClick={toggleFilters} className="filter-btn">
              {showFilters ? <X size={16} /> : <Filter size={16} />}
            </button>
          </Tippy>
          
          <Tippy content="Clear Chat">
            <button onClick={clearConversation} className="clear-btn">
              <RefreshCw size={16} />
            </button>
          </Tippy>
          
          <Tippy content={`Switch to ${themeMode === 'light' ? 'Dark' : 'Light'} Mode`}>
            <button onClick={toggleTheme} className="theme-toggle">
              {themeMode === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </Tippy>
        </div>
      </header>
      
      <main className="app-main">
        {/* Filter sidebar */}
        <div className={`filter-sidebar ${showFilters ? 'active' : ''}`}>
          <h2>Filters</h2>
          
          <div className="filter-search">
            <input
              type="text"
              value={filterSearch}
              onChange={handleFilterSearchChange}
              placeholder="Search filters..."
            />
          </div>
          
          <div className="filter-section">
            <h3>
              <span>Brawlers</span>
            </h3>
            <div className="filter-options">
              {filterItems(filters.brawlers || []).slice(0, 20).map(brawler => (
                <button
                  key={brawler.id}
                  className={`filter-option ${activeFilters.brawlers.includes(brawler.id) ? 'active' : ''}`}
                  onClick={() => handleFilterChange('brawlers', brawler.id)}
                >
                  {brawler.name}
                </button>
              ))}
            </div>
          </div>
          
          <div className="filter-section">
            <h3>
              <span>Game Modes</span>
            </h3>
            <div className="filter-options">
              {filterItems(filters.gameModes || []).map(mode => (
                <button
                  key={mode.id}
                  className={`filter-option ${activeFilters.gameModes.includes(mode.id) ? 'active' : ''}`}
                  onClick={() => handleFilterChange('gameModes', mode.id)}
                >
                  {mode.name}
                </button>
              ))}
            </div>
          </div>
          
          <div className="filter-section">
            <h3>
              <span>Content Type</span>
            </h3>
            <div className="filter-options">
              {filterItems(filters.contentTypes || []).map(type => (
                <button
                  key={type.id}
                  className={`filter-option ${activeFilters.contentTypes.includes(type.id) ? 'active' : ''}`}
                  onClick={() => handleFilterChange('contentTypes', type.id)}
                >
                  {type.name}
                </button>
              ))}
            </div>
          </div>
          
          <div className="filter-section">
            <h3>
              <span>Skill Level</span>
            </h3>
            <div className="filter-options">
              {filterItems(filters.skillLevels || []).map(level => (
                <button
                  key={level.id}
                  className={`filter-option ${activeFilters.skillLevel === level.id ? 'active' : ''}`}
                  onClick={() => handleFilterChange('skillLevel', level.id)}
                >
                  {level.name}
                </button>
              ))}
            </div>
          </div>
          
          <div className="filter-section">
            <h3>
              <span>Sort By</span>
            </h3>
            <div className="filter-options">
              {filterItems(filters.sortOptions || []).map(option => (
                <button
                  key={option.id}
                  className={`filter-option ${activeFilters.sortBy === option.id ? 'active' : ''}`}
                  onClick={() => handleFilterChange('sortBy', option.id)}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </div>
          
          <div className="filter-section">
            <h3>
              <span>Advanced Filters</span>
            </h3>
            
            <div className="filter-group">
              <label htmlFor="minViews">Minimum Views</label>
              <input
                type="number"
                id="minViews"
                value={activeFilters.minViews}
                onChange={(e) => setActiveFilters(prev => ({ ...prev, minViews: parseInt(e.target.value) || 0 }))}
                min="0"
                step="1000"
              />
            </div>
            
            <div className="filter-group">
              <label htmlFor="maxDuration">Max Duration (seconds)</label>
              <input
                type="number"
                id="maxDuration"
                value={activeFilters.maxDuration}
                onChange={(e) => setActiveFilters(prev => ({ ...prev, maxDuration: parseInt(e.target.value) || 0 }))}
                min="0"
                step="60"
              />
            </div>
          </div>
          
          <div className="filter-actions">
            <button onClick={handleFilterSearch} className="apply-filters-btn">
              Apply Filters
            </button>
            <button onClick={clearFilters} className="clear-filters-btn">
              Clear Filters
            </button>
          </div>
        </div>
        
        <div className="content-area">
          {/* Video details view */}
          {videoDetails ? (
            <div className="video-details">
              <button onClick={() => setVideoDetails(null)} className="back-btn">
                Back to Results
              </button>
              
              <div className="video-player-container">
                <iframe
                  ref={videoPlayerRef}
                  src={`https://www.youtube.com/embed/${videoDetails.youtubeId}?autoplay=1`}
                  title={videoDetails.title}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                ></iframe>
              </div>
              
              <div className="video-info-detailed">
                <div className="video-info-header">
                  <h2>{videoDetails.title}</h2>
                  
                  <button 
                    className="video-share-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      shareVideo(videoDetails);
                    }}
                  >
                    <Share size={16} />
                    Share
                  </button>
                </div>
                
                <div className="video-info-meta">
                  <div className="video-meta-item">
                    <User size={16} />
                    {videoDetails.creator.name}
                  </div>
                  
                  <div className="video-meta-item">
                    <Eye size={16} />
                    {formatNumber(videoDetails.viewCount)} views
                  </div>
                  
                  <div className="video-meta-item">
                    <Calendar size={16} />
                    {formatDate(videoDetails.publishedAt)}
                  </div>
                  
                  <div className="video-meta-item">
                    <Clock size={16} />
                    {formatDuration(videoDetails.duration)}
                  </div>
                </div>
                
                <div className="video-tags-container">
                  {videoDetails.brawlers && videoDetails.brawlers.map((brawler, index) => (
                    <span key={`brawler-${index}`} className="video-tag brawler">{brawler}</span>
                  ))}
                  
                  {videoDetails.gameModes && videoDetails.gameModes.map((mode, index) => (
                    <span key={`mode-${index}`} className="video-tag mode">{mode}</span>
                  ))}
                  
                  {videoDetails.contentType && videoDetails.contentType.map((type, index) => (
                    <span key={`type-${index}`} className="video-tag content-type">{type}</span>
                  ))}
                </div>
                
                <div className="video-details-grid">
                  <div className="video-section">
                    <h3>Description</h3>
                    <p className="video-description">{videoDetails.description}</p>
                  </div>
                  
                  <div className="video-section">
                    <div className="video-feedback">
                      <h3>Was this helpful?</h3>
                      <div className="feedback-buttons">
                        <button 
                          className="feedback-btn"
                          onClick={() => submitFeedback(videoDetails.youtubeId, 'like')}
                        >
                          <ThumbsUp size={16} />
                          Yes, helpful
                        </button>
                        
                        <button 
                          className="feedback-btn"
                          onClick={() => submitFeedback(videoDetails.youtubeId, 'dislike')}
                        >
                          <ThumbsDown size={16} />
                          Not helpful
                        </button>
                      </div>
                    </div>
                    
                    {/* Timestamps */}
                    {videoDetails.timestamps && videoDetails.timestamps.length > 0 && (
                      <div className="video-timestamps">
                        <h3>Key Moments</h3>
                        <ul>
                          {videoDetails.timestamps.map((timestamp, index) => (
                            <li key={index} className="timestamp-item">
                              <button
                                onClick={() => {
                                  if (videoPlayerRef.current) {
                                    const src = videoPlayerRef.current.src;
                                    const baseUrl = src.split('?')[0];
                                    videoPlayerRef.current.src = `${baseUrl}?autoplay=1&start=${timestamp.time}`;
                                  }
                                }}
                                className="timestamp-btn"
                              >
                                {formatDuration(timestamp.time)}
                              </button>
                              <span className="timestamp-title">{timestamp.title || 'Highlight'}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Open in YouTube button */}
                <a 
                  href={`https://www.youtube.com/watch?v=${videoDetails.youtubeId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="open-youtube-btn"
                >
                  <ExternalLink size={16} />
                  Watch on YouTube
                </a>
              </div>
            </div>
          ) : (
            <>
              {/* Chat interface */}
              <div className="chat-container">
                <div className="chat-header">
                  <h2>Brawl Stars Content Navigator</h2>
                </div>
                
                <div className="messages">
                  {messages.map(renderMessage)}
                  
                  {loading && (
                    <div className="message assistant">
                      <div className="message-content loading">
                        <span className="dot"></span>
                        <span className="dot"></span>
                        <span className="dot"></span>
                      </div>
                    </div>
                  )}
                  
                  <div ref={messagesEndRef} />
                </div>
                
                <form onSubmit={handleSendMessage} className="message-form">
                  <div className="message-input-container">
                    <input
                      type="text"
                      ref={searchInputRef}
                      value={input}
                      onChange={handleInputChange}
                      placeholder="Ask about Brawl Stars videos..."
                      disabled={loading}
                      className="message-input"
                    />
                    
                    <div className="input-actions">
                      <Tippy content="Voice Input">
                        <button
                          type="button"
                          className="input-action-btn"
                          onClick={isRecording ? stopRecording : startRecording}
                          disabled={loading}
                        >
                          <Mic size={18} color={isRecording ? '#f45d48' : undefined} />
                        </button>
                      </Tippy>
                    </div>
                  </div>
                  
                  <button 
                    type="submit" 
                    disabled={loading || !input.trim()}
                    className="send-button"
                  >
                    <Send size={16} />
                    Send
                  </button>
                </form>
              </div>
              
              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="search-results">
                  <div className="section-header">
                    <h2>Search Results</h2>
                    
                    <div className="section-actions">
                      <Tippy content={`Switch to ${viewMode === 'grid' ? 'List' : 'Grid'} View`}>
                        <button 
                          className="view-toggle-btn"
                          onClick={toggleViewMode}
                        >
                          {viewMode === 'grid' ? <List size={16} /> : <Grid size={16} />}
                        </button>
                      </Tippy>
                      
                      <div className="sort-dropdown">
                        <select
                          value={activeFilters.sortBy}
                          onChange={(e) => setActiveFilters(prev => ({ ...prev, sortBy: e.target.value }))}
                        >
                          {filters.sortOptions && filters.sortOptions.map(option => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  
                  {searchResults.length > 0 ? (
                    <div className={`video-grid ${viewMode === 'list' ? 'list-view' : ''}`}>
                      {searchResults.map(renderVideoCard)}
                    </div>
                  ) : (
                    renderEmptyState()
                  )}
                  
                  {renderPagination()}
                </div>
              )}
              
              {/* Recommendations */}
              {searchResults.length === 0 && recommendations.length > 0 && (
                <div className="recommendations">
                  <div className="section-header">
                    <h2>Recommended for You</h2>
                    
                    <div className="section-actions">
                      <Tippy content={`Switch to ${viewMode === 'grid' ? 'List' : 'Grid'} View`}>
                        <button 
                          className="view-toggle-btn"
                          onClick={toggleViewMode}
                        >
                          {viewMode === 'grid' ? <List size={16} /> : <Grid size={16} />}
                        </button>
                      </Tippy>
                      
                      <Tippy content="Refresh Recommendations">
                        <button 
                          className="view-toggle-btn"
                          onClick={fetchRecommendations}
                        >
                          <RefreshCw size={16} />
                        </button>
                      </Tippy>
                    </div>
                  </div>
                  
                  <div className={`video-grid ${viewMode === 'list' ? 'list-view' : ''}`}>
                    {recommendations.map(renderVideoCard)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      
      <footer className="app-footer">
        <p>&copy; {new Date().getFullYear()} Brawl Stars Content Navigator | 
          <a href="#" target="_blank" rel="noopener noreferrer"> Terms of Service</a> | 
          <a href="#" target="_blank" rel="noopener noreferrer"> Privacy Policy</a>
        </p>
      </footer>
      
      {/* Toast notifications */}
      {renderToasts()}
    </div>
  );
}

export default App;
