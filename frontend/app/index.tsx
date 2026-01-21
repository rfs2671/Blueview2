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
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/contexts/AuthContext';
import Constants from 'expo-constants';

const { width } = Dimensions.get('window');

// High-contrast construction theme colors
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
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, token, isLoading, isAuthenticated, logout } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({
    totalWorkers: 0,
    activeProjects: 0,
    todayCheckins: 0,
  });
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);

  const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || 
    process.env.EXPO_PUBLIC_BACKEND_URL || '';

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    } else if (isAuthenticated && user?.role === 'worker' && !user?.has_passport) {
      router.replace('/onboarding');
    } else if (isAuthenticated) {
      fetchDashboardData();
    }
  }, [isLoading, isAuthenticated, user]);

  const fetchDashboardData = async () => {
    if (!token) return;
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [workersRes, projectsRes] = await Promise.all([
        fetch(`${API_URL}/api/workers`, { headers }),
        fetch(`${API_URL}/api/projects`, { headers }),
      ]);

      const workers = await workersRes.json();
      const projects = await projectsRes.json();

      setStats({
        totalWorkers: Array.isArray(workers) ? workers.length : 0,
        activeProjects: Array.isArray(projects) ? projects.length : 0,
        todayCheckins: 0,
      });

      setRecentProjects(Array.isArray(projects) ? projects.slice(0, 3) : []);
    } catch (error) {
      console.log('Error fetching dashboard data:', error);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await fetchDashboardData();
    setRefreshing(false);
  }, [token]);

  const handleNavigation = (route: string) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.push(route as any);
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

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

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return COLORS.primary;
      case 'cp': return COLORS.secondary;
      case 'subcontractor': return '#E91E63';
      default: return COLORS.success;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Site Operations Hub</Text>
          <Text style={styles.appName}>BLUEVIEW</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={[styles.roleBadge, { backgroundColor: getRoleBadgeColor(user?.role || '') }]}>
            <Text style={styles.roleText}>{user?.role?.toUpperCase()}</Text>
          </View>
          <TouchableOpacity style={styles.settingsButton} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={22} color={COLORS.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* User Info Bar */}
      <View style={styles.userBar}>
        <View style={styles.userAvatar}>
          <Text style={styles.userAvatarText}>
            {user?.name?.split(' ').map(n => n[0]).join('').toUpperCase() || 'U'}
          </Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
        </View>
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
        
        {/* Admin-only: User Management */}
        {user?.role === 'admin' && (
          <QuickActionCard
            icon="shield-checkmark"
            title="User Management"
            subtitle="Manage CPs and Workers"
            color={COLORS.primary}
            onPress={() => handleNavigation('/admin/users')}
          />
        )}

        {/* Admin & CP: Worker Registry */}
        {(user?.role === 'admin' || user?.role === 'cp') && (
          <QuickActionCard
            icon="person-add"
            title="Worker Registry"
            subtitle="Manage worker passports"
            color={COLORS.primary}
            onPress={() => handleNavigation('/workers')}
          />
        )}

        {/* Admin-only: Projects Management */}
        {user?.role === 'admin' && (
          <QuickActionCard
            icon="business"
            title="Projects"
            subtitle="Manage job sites"
            color={COLORS.secondary}
            onPress={() => handleNavigation('/projects')}
          />
        )}

        {/* CP: Assigned Projects */}
        {user?.role === 'cp' && (
          <QuickActionCard
            icon="business"
            title="My Projects"
            subtitle="View assigned projects"
            color={COLORS.secondary}
            onPress={() => handleNavigation('/projects')}
          />
        )}

        {/* All roles: QR Scanner */}
        <QuickActionCard
          icon="scan"
          title="QR Scanner"
          subtitle="Scan project QR to check in"
          color={COLORS.success}
          onPress={() => handleNavigation('/scan')}
        />

        {/* Admin & CP: Check-In */}
        {(user?.role === 'admin' || user?.role === 'cp') && (
          <QuickActionCard
            icon="people"
            title="Manual Check-In"
            subtitle="Check in workers manually"
            color="#9C27B0"
            onPress={() => handleNavigation('/checkin')}
          />
        )}

        {/* Admin & CP: Daily Log */}
        {(user?.role === 'admin' || user?.role === 'cp') && (
          <QuickActionCard
            icon="document-text"
            title="Super Daily Log"
            subtitle="Create today's site report"
            color={COLORS.warning}
            onPress={() => handleNavigation('/daily-log')}
          />
        )}

        {/* Admin & CP: Reports */}
        {(user?.role === 'admin' || user?.role === 'cp') && (
          <QuickActionCard
            icon="analytics"
            title="Reports"
            subtitle="View & download daily reports"
            color="#9C27B0"
            onPress={() => handleNavigation('/reports')}
          />
        )}

        {/* Admin-only: Subcontractors */}
        {user?.role === 'admin' && (
          <QuickActionCard
            icon="people-circle"
            title="Subcontractors"
            subtitle="Manage subcontractor accounts"
            color="#E91E63"
            onPress={() => handleNavigation('/admin/subcontractors')}
          />
        )}

        {/* Admin & Subcontractor: Material Requests */}
        {(user?.role === 'admin' || user?.role === 'subcontractor') && (
          <QuickActionCard
            icon="cube"
            title="Material Requests"
            subtitle={user?.role === 'admin' ? "View all requests" : "Submit material requests"}
            color="#00BCD4"
            onPress={() => handleNavigation('/materials')}
          />
        )}

        {/* Worker: My Passport */}
        {user?.role === 'worker' && user?.has_passport && (
          <QuickActionCard
            icon="id-card"
            title="My Passport"
            subtitle="View your worker passport"
            color={COLORS.primary}
            onPress={() => handleNavigation(`/workers/${user.worker_passport_id}`)}
          />
        )}

        {/* Recent Projects */}
        {recentProjects.length > 0 && (user?.role === 'admin' || user?.role === 'cp') && (
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  roleText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.text,
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userAvatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  userInfo: {
    marginLeft: 12,
  },
  userName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  userEmail: {
    fontSize: 12,
    color: COLORS.textSecondary,
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
