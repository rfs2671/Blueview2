import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  Platform,
  Modal,
  TextInput,
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

const STATUS_COLORS: Record<string, string> = {
  pending: COLORS.warning,
  approved: COLORS.secondary,
  ordered: COLORS.primary,
  delivered: COLORS.success,
  rejected: COLORS.danger,
};

interface MaterialRequest {
  id: string;
  project_id: string;
  subcontractor_company: string;
  items: Array<{ name: string; quantity: number; unit: string; notes?: string }>;
  priority: string;
  needed_by?: string;
  notes?: string;
  status: string;
  created_at: string;
  admin_notes?: string;
}

interface Project {
  id: string;
  name: string;
}

export default function MaterialRequestsScreen() {
  const router = useRouter();
  const { token, user } = useAuth();
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<MaterialRequest | null>(null);
  
  // Form state
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [priority, setPriority] = useState('normal');
  const [neededBy, setNeededBy] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<Array<{ name: string; quantity: string; unit: string; notes: string }>>([
    { name: '', quantity: '', unit: 'units', notes: '' }
  ]);
  
  const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || 
    process.env.EXPO_PUBLIC_BACKEND_URL || '';

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [requestsRes, projectsRes] = await Promise.all([
        fetch(`${API_URL}/api/material-requests`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/api/projects`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      
      const requestsData = await requestsRes.json();
      const projectsData = await projectsRes.json();
      
      setRequests(Array.isArray(requestsData) ? requestsData : []);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
    } catch (error) {
      console.log('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await fetchData();
    setRefreshing(false);
  }, [token]);

  const addItem = () => {
    setItems([...items, { name: '', quantity: '', unit: 'units', notes: '' }]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (index: number, field: string, value: string) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const handleCreate = async () => {
    if (!selectedProjectId) {
      Alert.alert('Required', 'Please select a project');
      return;
    }

    const validItems = items.filter(item => item.name.trim() !== '');
    if (validItems.length === 0) {
      Alert.alert('Required', 'Please add at least one item');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/api/material-requests`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_id: selectedProjectId,
          items: validItems.map(item => ({
            name: item.name,
            quantity: parseInt(item.quantity) || 1,
            unit: item.unit,
            notes: item.notes,
          })),
          priority,
          needed_by: neededBy || null,
          notes: notes || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create request');
      }

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      
      // Reset form
      setSelectedProjectId('');
      setPriority('normal');
      setNeededBy('');
      setNotes('');
      setItems([{ name: '', quantity: '', unit: 'units', notes: '' }]);
      setShowAddModal(false);
      
      Alert.alert('Success', 'Material request submitted');
      fetchData();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateStatus = async (requestId: string, newStatus: string) => {
    if (user?.role !== 'admin') return;
    
    try {
      await fetch(`${API_URL}/api/material-requests/${requestId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });
      
      fetchData();
    } catch (error) {
      Alert.alert('Error', 'Failed to update status');
    }
  };

  const getProjectName = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    return project?.name || 'Unknown Project';
  };

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
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Material Requests</Text>
          <Text style={styles.headerSubtitle}>{requests.length} requests</Text>
        </View>
        {(user?.role === 'subcontractor' || user?.role === 'admin') && (
          <TouchableOpacity 
            style={styles.addButton}
            onPress={() => setShowAddModal(true)}
          >
            <Ionicons name="add" size={24} color={COLORS.text} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        }
      >
        {requests.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={64} color={COLORS.border} />
            <Text style={styles.emptyTitle}>No Requests</Text>
            <Text style={styles.emptySubtitle}>
              Material requests from subcontractors will appear here
            </Text>
          </View>
        ) : (
          requests.map((req) => (
            <TouchableOpacity 
              key={req.id} 
              style={styles.card}
              onPress={() => setSelectedRequest(req)}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[req.status] + '20' }]}>
                  <Text style={[styles.statusText, { color: STATUS_COLORS[req.status] }]}>
                    {req.status.toUpperCase()}
                  </Text>
                </View>
                <View style={[styles.priorityBadge, { 
                  backgroundColor: req.priority === 'urgent' ? COLORS.danger + '20' : COLORS.surfaceLight 
                }]}>
                  <Text style={[styles.priorityText, { 
                    color: req.priority === 'urgent' ? COLORS.danger : COLORS.textSecondary 
                  }]}>
                    {req.priority.toUpperCase()}
                  </Text>
                </View>
              </View>
              
              <Text style={styles.projectName}>{getProjectName(req.project_id)}</Text>
              <Text style={styles.companyName}>From: {req.subcontractor_company}</Text>
              
              <View style={styles.itemsList}>
                {req.items.slice(0, 3).map((item, i) => (
                  <Text key={i} style={styles.itemText}>
                    • {item.quantity} {item.unit} - {item.name}
                  </Text>
                ))}
                {req.items.length > 3 && (
                  <Text style={styles.moreItems}>+{req.items.length - 3} more items</Text>
                )}
              </View>
              
              {req.needed_by && (
                <View style={styles.neededBy}>
                  <Ionicons name="calendar-outline" size={14} color={COLORS.textSecondary} />
                  <Text style={styles.neededByText}>Needed by: {req.needed_by}</Text>
                </View>
              )}
              
              {user?.role === 'admin' && req.status === 'pending' && (
                <View style={styles.actionButtons}>
                  <TouchableOpacity 
                    style={[styles.actionBtn, styles.approveBtn]}
                    onPress={() => handleUpdateStatus(req.id, 'approved')}
                  >
                    <Text style={styles.actionBtnText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.actionBtn, styles.rejectBtn]}
                    onPress={() => handleUpdateStatus(req.id, 'rejected')}
                  >
                    <Text style={styles.actionBtnText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          ))
        )}
        
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Add Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Material Request</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.formScroll}>
              <View style={styles.formGroup}>
                <Text style={styles.label}>Project *</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {projects.map(project => (
                    <TouchableOpacity
                      key={project.id}
                      style={[
                        styles.projectChip,
                        selectedProjectId === project.id && styles.projectChipSelected
                      ]}
                      onPress={() => setSelectedProjectId(project.id)}
                    >
                      <Text style={[
                        styles.projectChipText,
                        selectedProjectId === project.id && styles.projectChipTextSelected
                      ]}>
                        {project.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Priority</Text>
                <View style={styles.priorityRow}>
                  {['low', 'normal', 'high', 'urgent'].map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.priorityOption,
                        priority === p && styles.priorityOptionSelected
                      ]}
                      onPress={() => setPriority(p)}
                    >
                      <Text style={[
                        styles.priorityOptionText,
                        priority === p && styles.priorityOptionTextSelected
                      ]}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.formGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Items *</Text>
                  <TouchableOpacity onPress={addItem}>
                    <Ionicons name="add-circle" size={24} color={COLORS.primary} />
                  </TouchableOpacity>
                </View>
                
                {items.map((item, index) => (
                  <View key={index} style={styles.itemRow}>
                    <TextInput
                      style={[styles.input, styles.itemName]}
                      value={item.name}
                      onChangeText={(v) => updateItem(index, 'name', v)}
                      placeholder="Item name"
                      placeholderTextColor={COLORS.textSecondary}
                    />
                    <TextInput
                      style={[styles.input, styles.itemQty]}
                      value={item.quantity}
                      onChangeText={(v) => updateItem(index, 'quantity', v)}
                      placeholder="Qty"
                      placeholderTextColor={COLORS.textSecondary}
                      keyboardType="numeric"
                    />
                    {items.length > 1 && (
                      <TouchableOpacity onPress={() => removeItem(index)}>
                        <Ionicons name="close-circle" size={24} color={COLORS.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Needed By (Optional)</Text>
                <TextInput
                  style={styles.input}
                  value={neededBy}
                  onChangeText={setNeededBy}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Notes (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.notesInput]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Additional notes..."
                  placeholderTextColor={COLORS.textSecondary}
                  multiline
                  numberOfLines={3}
                />
              </View>

              <TouchableOpacity
                style={[styles.submitButton, saving && styles.buttonDisabled]}
                onPress={handleCreate}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={COLORS.text} />
                ) : (
                  <Text style={styles.submitButtonText}>Submit Request</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
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
    justifyContent: 'space-between',
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
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 40,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  priorityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  priorityText: {
    fontSize: 11,
    fontWeight: '600',
  },
  projectName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  companyName: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  itemsList: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  itemText: {
    fontSize: 13,
    color: COLORS.text,
    marginBottom: 4,
  },
  moreItems: {
    fontSize: 12,
    color: COLORS.secondary,
    fontStyle: 'italic',
  },
  neededBy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  neededByText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  approveBtn: {
    backgroundColor: COLORS.success,
  },
  rejectBtn: {
    backgroundColor: COLORS.danger,
  },
  actionBtnText: {
    color: COLORS.text,
    fontWeight: '600',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
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
  formScroll: {
    padding: 20,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  notesInput: {
    height: 80,
    textAlignVertical: 'top',
  },
  projectChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.surfaceLight,
    marginRight: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  projectChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  projectChipText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  projectChipTextSelected: {
    color: COLORS.text,
    fontWeight: '600',
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  priorityOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  priorityOptionSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  priorityOptionText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  priorityOptionTextSelected: {
    color: COLORS.text,
    fontWeight: '600',
  },
  itemRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  itemName: {
    flex: 1,
  },
  itemQty: {
    width: 70,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 40,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
});
