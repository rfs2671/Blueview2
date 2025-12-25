import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/colors';
import { api } from '../../src/utils/api';

interface Project {
  id: string;
  name: string;
  location: string;
  address?: string;
  qr_code: string;
  created_at: string;
}

interface CheckInStats {
  company: string;
  worker_count: number;
  workers: { name: string; trade: string }[];
}

export default function ProjectDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [stats, setStats] = useState<CheckInStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProjectData();
  }, [id]);

  const fetchProjectData = async () => {
    try {
      const [projectData, statsData] = await Promise.all([
        api.getProject(id as string),
        api.getCheckinStats(id as string),
      ]);
      setProject(projectData);
      setStats(Array.isArray(statsData) ? statsData : []);
    } catch (error) {
      console.log('Error fetching project:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalWorkers = stats.reduce((sum, s) => sum + s.worker_count, 0);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!project) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>Project not found</Text>
        </View>
      </SafeAreaView>
    );
  }

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
          <Text style={styles.headerTitle}>{project.name}</Text>
          <Text style={styles.headerSubtitle}>{project.location}</Text>
        </View>
        <View style={styles.qrBadge}>
          <Text style={styles.qrText}>{project.qr_code}</Text>
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Stats Section */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Ionicons name="people" size={24} color={COLORS.primary} />
            <Text style={styles.statValue}>{totalWorkers}</Text>
            <Text style={styles.statLabel}>On-Site Today</Text>
          </View>
          <View style={styles.statBox}>
            <Ionicons name="business" size={24} color={COLORS.secondary} />
            <Text style={styles.statValue}>{stats.length}</Text>
            <Text style={styles.statLabel}>Subcontractors</Text>
          </View>
        </View>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }
              router.push(`/checkin?projectId=${project.id}`);
            }}
          >
            <View style={[styles.actionIcon, { backgroundColor: COLORS.success + '20' }]}>
              <Ionicons name="person-add" size={24} color={COLORS.success} />
            </View>
            <Text style={styles.actionTitle}>Check-In</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }
              router.push(`/daily-log?projectId=${project.id}`);
            }}
          >
            <View style={[styles.actionIcon, { backgroundColor: COLORS.warning + '20' }]}>
              <Ionicons name="document-text" size={24} color={COLORS.warning} />
            </View>
            <Text style={styles.actionTitle}>Daily Log</Text>
          </TouchableOpacity>
        </View>

        {/* On-Site Workers */}
        {stats.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>On-Site Workers</Text>
            {stats.map((stat, index) => (
              <View key={index} style={styles.companyCard}>
                <View style={styles.companyHeader}>
                  <View style={styles.companyBadge}>
                    <Text style={styles.companyInitial}>
                      {stat.company.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.companyInfo}>
                    <Text style={styles.companyName}>{stat.company}</Text>
                    <Text style={styles.workerCount}>{stat.worker_count} workers</Text>
                  </View>
                </View>
                <View style={styles.workersList}>
                  {stat.workers.map((worker, wIndex) => (
                    <View key={wIndex} style={styles.workerTag}>
                      <Text style={styles.workerName}>{worker.name}</Text>
                      <Text style={styles.workerTrade}>{worker.trade}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </>
        )}

        {stats.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={48} color={COLORS.textSecondary} />
            <Text style={styles.emptyTitle}>No Workers On-Site</Text>
            <Text style={styles.emptySubtitle}>Check in workers to see them here</Text>
          </View>
        )}

        <View style={{ height: 30 }} />
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
  errorText: {
    fontSize: 16,
    color: COLORS.danger,
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
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  qrBadge: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  qrText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.secondary,
    letterSpacing: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
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
  },
  actionsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  actionCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  companyCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  companyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  companyBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  companyInitial: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  companyInfo: {
    flex: 1,
    marginLeft: 12,
  },
  companyName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  workerCount: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  workersList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  workerTag: {
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  workerName: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  workerTrade: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
});
