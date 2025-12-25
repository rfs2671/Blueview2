import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Dimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';

const { width } = Dimensions.get('window');
const CARD_PADDING = 16;

// High-contrast construction theme colors
const COLORS = {
  background: '#0A1929',
  surface: '#132F4C',
  surfaceLight: '#1E3A5F',
  primary: '#FF6B00', // Construction orange
  secondary: '#00D4FF',
  success: '#4CAF50',
  warning: '#FFB800',
  danger: '#FF4444',
  text: '#FFFFFF',
  textSecondary: '#B0BEC5',
  border: '#2D4A6F',
};

interface Project {
  id: string;
  name: string;
  location: string;
  qr_code: string;
}

interface DashboardStats {
  totalWorkers: number;
  activeProjects: number;
  todayCheckins: number;
  pendingLogs: number;
}

export default function HomeScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({
    totalWorkers: 0,
    activeProjects: 0,
    todayCheckins: 0,
    pendingLogs: 0,
  });
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);

  const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || 
    process.env.EXPO_PUBLIC_BACKEND_URL || '';

  const fetchDashboardData = async () => {
    try {
      const [workersRes, projectsRes] = await Promise.all([
        fetch(`${API_URL}/api/workers`),
        fetch(`${API_URL}/api/projects`),
      ]);

      const workers = await workersRes.json();
      const projects = await projectsRes.json();

      setStats({
        totalWorkers: Array.isArray(workers) ? workers.length : 0,
        activeProjects: Array.isArray(projects) ? projects.length : 0,
        todayCheckins: 0,
        pendingLogs: 0,
      });

      setRecentProjects(Array.isArray(projects) ? projects.slice(0, 3) : []);
    } catch (error) {
      console.log('Error fetching dashboard data:', error);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await fetchDashboardData();
    setRefreshing(false);
  }, []);

  const handleNavigation = (route: string) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.push(route as any);
  };

  const QuickActionCard = ({ 
    icon, 
    title, 
    subtitle, 
    color, 
    onPress 
  }: { 
    icon: keyof typeof Ionicons.glyphMap; 
    title: string; 
    subtitle: string; 
    color: string; 
    onPress: () => void;
  }) => (
    <TouchableOpacity
      style={[styles.quickActionCard, { borderLeftColor: color }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.iconContainer, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon} size={28} color={color} />
      </View>
      <View style={styles.cardTextContainer}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={24} color={COLORS.textSecondary} />
    </TouchableOpacity>
  );

  const StatBox = ({ value, label, icon }: { value: number; label: string; icon: keyof typeof Ionicons.glyphMap }) => (
    <View style={styles.statBox}>
      <Ionicons name={icon} size={24} color={COLORS.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Site Operations Hub</Text>
          <Text style={styles.appName}>BLUEVIEW</Text>
        </View>
        <TouchableOpacity style={styles.settingsButton}>
          <Ionicons name="settings-outline" size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
      >
        {/* Stats Row */}
        <View style={styles.statsContainer}>
          <StatBox value={stats.totalWorkers} label="Workers" icon="people" />
          <StatBox value={stats.activeProjects} label="Projects" icon="business" />
          <StatBox value={stats.todayCheckins} label="On-Site" icon="location" />
        </View>

        {/* Quick Actions Section */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        
        <QuickActionCard
          icon="person-add"
          title="Worker Registry"
          subtitle="Manage worker passports & signatures"
          color={COLORS.primary}
          onPress={() => handleNavigation('/workers')}
        />

        <QuickActionCard
          icon="business"
          title="Projects"
          subtitle="View & manage job sites"
          color={COLORS.secondary}
          onPress={() => handleNavigation('/projects')}
        />

        <QuickActionCard
          icon="scan"
          title="QR Scanner"
          subtitle="Scan project QR to check in"
          color={COLORS.success}
          onPress={() => handleNavigation('/scan')}
        />

        <QuickActionCard
          icon="people"
          title="Manual Check-In"
          subtitle="Check in workers manually"
          color="#9C27B0"
          onPress={() => handleNavigation('/checkin')}
        />

        <QuickActionCard
          icon="document-text"
          title="Super Daily Log"
          subtitle="Create today's site report"
          color={COLORS.warning}
          onPress={() => handleNavigation('/daily-log')}
        />

        {/* Recent Projects */}
        {recentProjects.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Recent Projects</Text>
            {recentProjects.map((project) => (
              <TouchableOpacity
                key={project.id}
                style={styles.projectCard}
                onPress={() => handleNavigation(`/project/${project.id}`)}
                activeOpacity={0.7}
              >
                <View style={styles.projectIcon}>
                  <Ionicons name="construct" size={20} color={COLORS.primary} />
                </View>
                <View style={styles.projectInfo}>
                  <Text style={styles.projectName}>{project.name}</Text>
                  <Text style={styles.projectLocation}>{project.location}</Text>
                </View>
                <View style={styles.qrBadge}>
                  <Text style={styles.qrText}>{project.qr_code}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  greeting: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  appName: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: 2,
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
    marginTop: 8,
  },
  quickActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  cardSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  projectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  projectIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  projectInfo: {
    flex: 1,
    marginLeft: 12,
  },
  projectName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  projectLocation: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  qrBadge: {
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  qrText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.secondary,
    letterSpacing: 1,
  },
  bottomPadding: {
    height: 40,
  },
});
