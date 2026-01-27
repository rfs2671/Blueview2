import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import Constants from 'expo-constants';

const COLORS = {
  background: '#0A1929',
  surface: '#132F4C',
  surfaceLight: '#1E3A5F',
  primary: '#FF6B00',
  secondary: '#00D4FF',
  success: '#4CAF50',
  warning: '#FFB800',
  danger: '#FF4444',
  text: '#FFFFFF',
  textSecondary: '#B0BEC5',
  border: '#2D4A6F',
};

interface CheckIn {
  id: string;
  worker_id: string;
  worker_name: string;
  worker_trade: string;
  worker_company: string;
  project_id: string;
  project_name: string;
  check_in_time: string;
  check_out_time?: string;
}

export default function DailySignInLogScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());

const API_URL = 'https://blueview2-production.up.railway.app';

  const fetchCheckins = async () => {
    if (!token) return;
    
    try {
      const dateStr = selectedDate.toISOString().split('T')[0];
      const response = await fetch(`${API_URL}/api/checkins?date=${dateStr}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.ok) {
        const data = await response.json();
        setCheckins(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.log('Error fetching checkins:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCheckins();
  }, [selectedDate, token]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await fetchCheckins();
    setRefreshing(false);
  }, [selectedDate, token]);

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const goToPreviousDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    setSelectedDate(newDate);
    setLoading(true);
  };

  const goToNextDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    if (newDate <= new Date()) {
      setSelectedDate(newDate);
      setLoading(true);
    }
  };

  const isToday = selectedDate.toDateString() === new Date().toDateString();

  const renderCheckin = ({ item }: { item: CheckIn }) => (
    <View style={styles.checkinCard}>
      <View style={styles.timeColumn}>
        <Text style={styles.timeText}>{formatTime(item.check_in_time)}</Text>
        {item.check_out_time && (
          <Text style={styles.checkoutText}>Out: {formatTime(item.check_out_time)}</Text>
        )}
      </View>
      
      <View style={styles.dividerLine} />
      
      <View style={styles.infoColumn}>
        <View style={styles.workerRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {item.worker_name.split(' ').map(n => n[0]).join('').toUpperCase()}
            </Text>
          </View>
          <View style={styles.workerInfo}>
            <Text style={styles.workerName}>{item.worker_name}</Text>
            <Text style={styles.workerTrade}>{item.worker_trade}</Text>
          </View>
        </View>
        
        <View style={styles.projectRow}>
          <Ionicons name="location" size={14} color={COLORS.secondary} />
          <Text style={styles.projectName}>{item.project_name}</Text>
        </View>
        
        <View style={styles.companyRow}>
          <Ionicons name="business-outline" size={14} color={COLORS.textSecondary} />
          <Text style={styles.companyName}>{item.worker_company}</Text>
        </View>
      </View>
    </View>
  );

  const EmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="calendar-outline" size={64} color={COLORS.textSecondary} />
      <Text style={styles.emptyTitle}>No Check-Ins</Text>
      <Text style={styles.emptySubtitle}>
        No workers have checked in {isToday ? 'today' : 'on this day'}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Daily Sign-In Log</Text>
          <Text style={styles.headerSubtitle}>{checkins.length} Check-ins</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {/* Date Selector */}
      <View style={styles.dateSelector}>
        <TouchableOpacity style={styles.dateArrow} onPress={goToPreviousDay}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        
        <View style={styles.dateDisplay}>
          <Ionicons name="calendar" size={18} color={COLORS.primary} />
          <Text style={styles.dateText}>{formatDate(selectedDate)}</Text>
          {isToday && <View style={styles.todayBadge}><Text style={styles.todayText}>TODAY</Text></View>}
        </View>
        
        <TouchableOpacity 
          style={[styles.dateArrow, isToday && styles.dateArrowDisabled]} 
          onPress={goToNextDay}
          disabled={isToday}
        >
          <Ionicons name="chevron-forward" size={24} color={isToday ? COLORS.border : COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Summary Stats */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <Ionicons name="people" size={20} color={COLORS.success} />
          <Text style={styles.summaryValue}>{checkins.length}</Text>
          <Text style={styles.summaryLabel}>Workers</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Ionicons name="business" size={20} color={COLORS.secondary} />
          <Text style={styles.summaryValue}>
            {new Set(checkins.map(c => c.project_id)).size}
          </Text>
          <Text style={styles.summaryLabel}>Projects</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Ionicons name="briefcase" size={20} color={COLORS.warning} />
          <Text style={styles.summaryValue}>
            {new Set(checkins.map(c => c.worker_company)).size}
          </Text>
          <Text style={styles.summaryLabel}>Companies</Text>
        </View>
      </View>

      {/* Check-ins List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={checkins}
          renderItem={renderCheckin}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            checkins.length === 0 && styles.emptyListContent,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.primary}
              colors={[COLORS.primary]}
            />
          }
          ListEmptyComponent={<EmptyState />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleContainer: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  dateSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
  },
  dateArrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateArrowDisabled: {
    opacity: 0.5,
  },
  dateDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  todayBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  todayText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.text,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 16,
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 4,
  },
  summaryLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: COLORS.border,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
  },
  emptyListContent: {
    flex: 1,
  },
  checkinCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  timeColumn: {
    width: 70,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.success,
  },
  checkoutText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  dividerLine: {
    width: 2,
    backgroundColor: COLORS.border,
    marginHorizontal: 12,
    borderRadius: 1,
  },
  infoColumn: {
    flex: 1,
  },
  workerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },
  workerInfo: {
    marginLeft: 10,
  },
  workerName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  workerTrade: {
    fontSize: 12,
    color: COLORS.secondary,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  projectName: {
    fontSize: 13,
    color: COLORS.secondary,
    fontWeight: '500',
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  companyName: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
});
