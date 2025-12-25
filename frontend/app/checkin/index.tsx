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
  ActivityIndicator,
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
  qr_code: string;
}

interface Worker {
  id: string;
  name: string;
  trade: string;
  company: string;
}

interface CheckIn {
  id: string;
  worker_id: string;
  worker_name: string;
  worker_company: string;
  worker_trade: string;
  check_in_time: string;
  check_out_time?: string;
}

export default function CheckInScreen() {
  const router = useRouter();
  const { projectId } = useLocalSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [showWorkerPicker, setShowWorkerPicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      fetchCheckins();
    }
  }, [selectedProject]);

  const fetchInitialData = async () => {
    try {
      const [projectsData, workersData] = await Promise.all([
        api.getProjects(),
        api.getWorkers(),
      ]);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setWorkers(Array.isArray(workersData) ? workersData : []);

      // Pre-select project if passed
      if (projectId && Array.isArray(projectsData)) {
        const project = projectsData.find((p: Project) => p.id === projectId);
        if (project) setSelectedProject(project);
      } else if (projectsData.length > 0) {
        setSelectedProject(projectsData[0]);
      }
    } catch (error) {
      console.log('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCheckins = async () => {
    if (!selectedProject) return;
    try {
      const data = await api.getActiveCheckins(selectedProject.id);
      setCheckins(Array.isArray(data) ? data : []);
    } catch (error) {
      console.log('Error fetching checkins:', error);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await fetchCheckins();
    setRefreshing(false);
  }, [selectedProject]);

  const handleCheckIn = async (worker: Worker) => {
    if (!selectedProject) return;

    try {
      await api.createCheckin({
        worker_id: worker.id,
        project_id: selectedProject.id,
      });
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setShowWorkerPicker(false);
      fetchCheckins();
      Alert.alert('Success', `${worker.name} checked in!`);
    } catch (error: any) {
      Alert.alert('Error', error?.detail || 'Failed to check in worker');
    }
  };

  const handleCheckOut = async (checkin: CheckIn) => {
    try {
      await api.checkout(checkin.id);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      fetchCheckins();
      Alert.alert('Success', `${checkin.worker_name} checked out!`);
    } catch (error) {
      Alert.alert('Error', 'Failed to check out worker');
    }
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getAvailableWorkers = () => {
    const checkedInWorkerIds = checkins.map((c) => c.worker_id);
    return workers.filter((w) => !checkedInWorkerIds.includes(w.id));
  };

  const renderCheckin = ({ item }: { item: CheckIn }) => (
    <View style={styles.checkinCard}>
      <View style={styles.workerAvatar}>
        <Text style={styles.avatarText}>
          {item.worker_name.split(' ').map((n) => n[0]).join('').toUpperCase()}
        </Text>
      </View>
      
      <View style={styles.checkinInfo}>
        <Text style={styles.workerName}>{item.worker_name}</Text>
        <Text style={styles.workerTrade}>{item.worker_trade}</Text>
        <Text style={styles.workerCompany}>{item.worker_company}</Text>
      </View>
      
      <View style={styles.checkinRight}>
        <View style={styles.timeContainer}>
          <Ionicons name="time" size={14} color={COLORS.success} />
          <Text style={styles.timeText}>{formatTime(item.check_in_time)}</Text>
        </View>
        <TouchableOpacity
          style={styles.checkoutButton}
          onPress={() => handleCheckOut(item)}
        >
          <Ionicons name="exit-outline" size={18} color={COLORS.danger} />
          <Text style={styles.checkoutText}>Out</Text>
        </TouchableOpacity>
      </View>
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
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Check-In</Text>
          <Text style={styles.headerSubtitle}>{checkins.length} On-Site</Text>
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => {
            if (workers.length === 0) {
              Alert.alert('No Workers', 'Please add workers first', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Add Workers', onPress: () => router.push('/workers') },
              ]);
              return;
            }
            if (Platform.OS !== 'web') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }
            setShowWorkerPicker(true);
          }}
        >
          <Ionicons name="person-add" size={22} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Project Selector */}
      <TouchableOpacity
        style={styles.projectSelector}
        onPress={() => setShowProjectPicker(true)}
      >
        <View style={styles.projectSelectorLeft}>
          <Ionicons name="business" size={20} color={COLORS.primary} />
          <Text style={styles.projectSelectorText}>
            {selectedProject?.name || 'Select Project'}
          </Text>
        </View>
        <View style={styles.projectSelectorRight}>
          {selectedProject && (
            <View style={styles.qrBadge}>
              <Text style={styles.qrText}>{selectedProject.qr_code}</Text>
            </View>
          )}
          <Ionicons name="chevron-down" size={20} color={COLORS.textSecondary} />
        </View>
      </TouchableOpacity>

      {/* Checkins List */}
      {projects.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="business-outline" size={64} color={COLORS.textSecondary} />
          <Text style={styles.emptyTitle}>No Projects</Text>
          <Text style={styles.emptySubtitle}>Create a project first to start checking in workers</Text>
          <TouchableOpacity
            style={styles.addFirstButton}
            onPress={() => router.push('/projects')}
          >
            <Text style={styles.addFirstText}>Create Project</Text>
          </TouchableOpacity>
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
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={64} color={COLORS.textSecondary} />
              <Text style={styles.emptyTitle}>No Workers On-Site</Text>
              <Text style={styles.emptySubtitle}>Tap + to check in a worker</Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Project Picker Modal */}
      <Modal
        visible={showProjectPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowProjectPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Project</Text>
              <TouchableOpacity onPress={() => setShowProjectPicker(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={projects}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.pickerItem,
                    selectedProject?.id === item.id && styles.pickerItemSelected,
                  ]}
                  onPress={() => {
                    setSelectedProject(item);
                    setShowProjectPicker(false);
                    if (Platform.OS !== 'web') {
                      Haptics.selectionAsync();
                    }
                  }}
                >
                  <View style={styles.pickerItemLeft}>
                    <Text style={styles.pickerItemTitle}>{item.name}</Text>
                    <Text style={styles.pickerItemSubtitle}>{item.location}</Text>
                  </View>
                  {selectedProject?.id === item.id && (
                    <Ionicons name="checkmark" size={24} color={COLORS.primary} />
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Worker Picker Modal */}
      <Modal
        visible={showWorkerPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowWorkerPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Check In Worker</Text>
              <TouchableOpacity onPress={() => setShowWorkerPicker(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={getAvailableWorkers()}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerItem}
                  onPress={() => handleCheckIn(item)}
                >
                  <View style={styles.workerAvatar}>
                    <Text style={styles.avatarText}>
                      {item.name.split(' ').map((n) => n[0]).join('').toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.pickerItemLeft}>
                    <Text style={styles.pickerItemTitle}>{item.name}</Text>
                    <Text style={styles.pickerItemSubtitle}>
                      {item.trade} • {item.company}
                    </Text>
                  </View>
                  <Ionicons name="add-circle" size={28} color={COLORS.success} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyPickerState}>
                  <Text style={styles.emptyPickerText}>All workers are checked in</Text>
                </View>
              }
            />
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
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.success,
    justifyContent: 'center',
    alignItems: 'center',
  },
  projectSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 14,
  },
  projectSelectorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  projectSelectorText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  projectSelectorRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qrBadge: {
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  qrText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.secondary,
    letterSpacing: 1,
  },
  listContent: {
    padding: 16,
  },
  emptyListContent: {
    flex: 1,
  },
  checkinCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  workerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  checkinInfo: {
    flex: 1,
    marginLeft: 12,
  },
  workerName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  workerTrade: {
    fontSize: 13,
    color: COLORS.secondary,
    marginTop: 1,
  },
  workerCompany: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  checkinRight: {
    alignItems: 'flex-end',
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  timeText: {
    fontSize: 12,
    color: COLORS.success,
    fontWeight: '600',
  },
  checkoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.danger + '20',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    gap: 4,
  },
  checkoutText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.danger,
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
  addFirstButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
  },
  addFirstText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: COLORS.surfaceLight,
  },
  pickerItemSelected: {
    backgroundColor: COLORS.primary + '20',
  },
  pickerItemLeft: {
    flex: 1,
    marginLeft: 10,
  },
  pickerItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  pickerItemSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  emptyPickerState: {
    padding: 30,
    alignItems: 'center',
  },
  emptyPickerText: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
});
