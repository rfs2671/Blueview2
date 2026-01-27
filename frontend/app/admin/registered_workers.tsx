import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Alert,
  Platform,
  Modal,
  Image,
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
  textMuted: '#607D8B',
  border: '#2D4A6F',
};

interface RegisteredWorker {
  id: string;
  name: string;
  osha_number: string;
  osha_card_type: string;
  trade: string;
  company: string;
  phone?: string;
  signature?: string;
  osha_card_image?: string;
  created_at: string;
  last_checkin?: string;
  total_checkins: number;
}

export default function RegisteredWorkersScreen() {
  const router = useRouter();
  const { token, user } = useAuth();
  const [workers, setWorkers] = useState<RegisteredWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<RegisteredWorker | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  
const API_URL = 'https://blueview2-production.up.railway.app';

  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'cp') {
      Alert.alert('Access Denied', 'You do not have access to this screen');
      router.back();
      return;
    }
    fetchWorkers();
  }, [user]);

  const fetchWorkers = async () => {
    if (!token) return;
    
    try {
      const response = await fetch(`${API_URL}/api/passport/registered-workers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.ok) {
        const data = await response.json();
        setWorkers(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.log('Error fetching registered workers:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await fetchWorkers();
    setRefreshing(false);
  }, [token]);

  const openWorkerDetail = (worker: RegisteredWorker) => {
    setSelectedWorker(worker);
    setShowDetailModal(true);
  };

  const handleDeleteWorker = (worker: RegisteredWorker) => {
    Alert.alert(
      'Delete Worker',
      `Remove ${worker.name} from the system? Their passport will be invalidated.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await fetch(`${API_URL}/api/passport/${worker.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
              fetchWorkers();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete worker');
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const renderWorker = ({ item }: { item: RegisteredWorker }) => (
    <TouchableOpacity
      style={styles.workerCard}
      onPress={() => openWorkerDetail(item)}
      activeOpacity={0.7}
    >
      <View style={styles.workerLeft}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {item.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)}
          </Text>
        </View>
        
        <View style={styles.workerInfo}>
          <Text style={styles.workerName}>{item.name}</Text>
          <Text style={styles.workerTrade}>{item.trade} • {item.company}</Text>
          <View style={styles.badgeRow}>
            <View style={styles.oshaBadge}>
              <Text style={styles.oshaBadgeText}>OSHA {item.osha_card_type}</Text>
            </View>
            {item.signature && (
              <View style={styles.signedBadge}>
                <Ionicons name="create" size={12} color={COLORS.text} />
                <Text style={styles.signedBadgeText}>Signed</Text>
              </View>
            )}
          </View>
        </View>
      </View>
      
      <View style={styles.workerRight}>
        <Text style={styles.checkinCount}>{item.total_checkins}</Text>
        <Text style={styles.checkinLabel}>check-ins</Text>
      </View>
    </TouchableOpacity>
  );

  const EmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="people-outline" size={64} color={COLORS.textSecondary} />
      <Text style={styles.emptyTitle}>No Workers Registered</Text>
      <Text style={styles.emptySubtitle}>
        Workers will appear here after they check in via NFC for the first time
      </Text>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Registered Workers</Text>
          <Text style={styles.headerSubtitle}>{workers.length} Workers</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Ionicons name="people" size={24} color={COLORS.primary} />
          <Text style={styles.statValue}>{workers.length}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="create" size={24} color={COLORS.success} />
          <Text style={styles.statValue}>{workers.filter(w => w.signature).length}</Text>
          <Text style={styles.statLabel}>With Signature</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="shield-checkmark" size={24} color={COLORS.secondary} />
          <Text style={styles.statValue}>{workers.filter(w => w.osha_card_type === '30').length}</Text>
          <Text style={styles.statLabel}>OSHA 30</Text>
        </View>
      </View>

      {/* Workers List */}
      <FlatList
        data={workers}
        renderItem={renderWorker}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          workers.length === 0 && styles.emptyListContent,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        }
        ListEmptyComponent={<EmptyState />}
        showsVerticalScrollIndicator={false}
      />

      {/* Worker Detail Modal */}
      <Modal
        visible={showDetailModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowDetailModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Worker Details</Text>
              <TouchableOpacity onPress={() => setShowDetailModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            {selectedWorker && (
              <View style={styles.detailContent}>
                {/* Worker Avatar & Name */}
                <View style={styles.detailHeader}>
                  <View style={styles.detailAvatar}>
                    <Text style={styles.detailAvatarText}>
                      {selectedWorker.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)}
                    </Text>
                  </View>
                  <Text style={styles.detailName}>{selectedWorker.name}</Text>
                  <View style={styles.detailBadges}>
                    <View style={styles.oshaBadgeLarge}>
                      <Text style={styles.oshaBadgeLargeText}>OSHA {selectedWorker.osha_card_type}</Text>
                    </View>
                    {selectedWorker.signature && (
                      <View style={styles.signedBadgeLarge}>
                        <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
                        <Text style={styles.signedBadgeLargeText}>Signature on File</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Info Rows */}
                <View style={styles.infoSection}>
                  <View style={styles.infoRow}>
                    <Ionicons name="construct" size={18} color={COLORS.textSecondary} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Trade</Text>
                      <Text style={styles.infoValue}>{selectedWorker.trade}</Text>
                    </View>
                  </View>

                  <View style={styles.infoRow}>
                    <Ionicons name="business" size={18} color={COLORS.textSecondary} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Company</Text>
                      <Text style={styles.infoValue}>{selectedWorker.company || 'Not provided'}</Text>
                    </View>
                  </View>

                  <View style={styles.infoRow}>
                    <Ionicons name="card" size={18} color={COLORS.textSecondary} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>OSHA Card Number</Text>
                      <Text style={styles.infoValue}>{selectedWorker.osha_number}</Text>
                    </View>
                  </View>

                  {selectedWorker.phone && (
                    <View style={styles.infoRow}>
                      <Ionicons name="call" size={18} color={COLORS.textSecondary} />
                      <View style={styles.infoContent}>
                        <Text style={styles.infoLabel}>Phone</Text>
                        <Text style={styles.infoValue}>{selectedWorker.phone}</Text>
                      </View>
                    </View>
                  )}

                  <View style={styles.infoRow}>
                    <Ionicons name="calendar" size={18} color={COLORS.textSecondary} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Registered</Text>
                      <Text style={styles.infoValue}>{formatDate(selectedWorker.created_at)}</Text>
                    </View>
                  </View>

                  <View style={styles.infoRow}>
                    <Ionicons name="log-in" size={18} color={COLORS.textSecondary} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Total Check-ins</Text>
                      <Text style={styles.infoValue}>{selectedWorker.total_checkins}</Text>
                    </View>
                  </View>

                  {selectedWorker.last_checkin && (
                    <View style={styles.infoRow}>
                      <Ionicons name="time" size={18} color={COLORS.textSecondary} />
                      <View style={styles.infoContent}>
                        <Text style={styles.infoLabel}>Last Check-in</Text>
                        <Text style={styles.infoValue}>{formatDate(selectedWorker.last_checkin)}</Text>
                      </View>
                    </View>
                  )}
                </View>

                {/* Signature Preview */}
                {selectedWorker.signature && (
                  <View style={styles.signatureSection}>
                    <Text style={styles.sectionTitle}>Digital Signature</Text>
                    <View style={styles.signaturePreview}>
                      <Image
                        source={{ uri: selectedWorker.signature }}
                        style={styles.signatureImage}
                        resizeMode="contain"
                      />
                    </View>
                    <Text style={styles.signatureNote}>
                      Used for auto-signing daily log books
                    </Text>
                  </View>
                )}

                {/* OSHA Card Image */}
                {selectedWorker.osha_card_image && (
                  <View style={styles.oshaCardSection}>
                    <Text style={styles.sectionTitle}>OSHA Card</Text>
                    <Image
                      source={{ uri: `data:image/jpeg;base64,${selectedWorker.osha_card_image}` }}
                      style={styles.oshaCardImage}
                      resizeMode="contain"
                    />
                  </View>
                )}

                {/* Delete Button */}
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => {
                    setShowDetailModal(false);
                    setTimeout(() => handleDeleteWorker(selectedWorker), 300);
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                  <Text style={styles.deleteButtonText}>Remove Worker</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
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
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 6,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  listContent: {
    padding: 16,
  },
  emptyListContent: {
    flex: 1,
  },
  workerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  workerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  workerInfo: {
    flex: 1,
    marginLeft: 12,
  },
  workerName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  workerTrade: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  oshaBadge: {
    backgroundColor: COLORS.secondary + '30',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  oshaBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.secondary,
  },
  signedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.success + '30',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 3,
  },
  signedBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.success,
  },
  workerRight: {
    alignItems: 'center',
    paddingLeft: 12,
  },
  checkinCount: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.primary,
  },
  checkinLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  detailContent: {
    padding: 20,
  },
  detailHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  detailAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailAvatarText: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.text,
  },
  detailName: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  detailBadges: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  oshaBadgeLarge: {
    backgroundColor: COLORS.secondary + '30',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  oshaBadgeLargeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.secondary,
  },
  signedBadgeLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.success + '20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 5,
  },
  signedBadgeLargeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.success,
  },
  infoSection: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 2,
  },
  signatureSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 10,
  },
  signaturePreview: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 10,
    height: 100,
  },
  signatureImage: {
    width: '100%',
    height: '100%',
  },
  signatureNote: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginTop: 6,
    textAlign: 'center',
  },
  oshaCardSection: {
    marginBottom: 16,
  },
  oshaCardImage: {
    width: '100%',
    height: 150,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceLight,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.danger + '20',
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: 10,
    gap: 8,
  },
  deleteButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.danger,
  },
});
