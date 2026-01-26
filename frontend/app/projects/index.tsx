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
  TextInput,
  Modal,
  KeyboardAvoidingView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import Constants from 'expo-constants';
import NfcManager, { NfcTech, Ndef } from 'react-native-nfc-manager';

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

interface Project {
  id: string;
  name: string;
  location: string;
  address?: string;
  qr_code: string;
  nfc_tags?: { tag_id: string; location_description: string }[];
}

interface NfcTag {
  tag_id: string;
  location_description: string;
}

export default function ProjectsScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newProject, setNewProject] = useState({
    name: '',
    location: '',
    address: '',
  });
  
  // NFC Tag Management
  const [nfcTags, setNfcTags] = useState<NfcTag[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [showNfcModal, setShowNfcModal] = useState(false);
  const [currentTagId, setCurrentTagId] = useState('');
  const [tagLocationName, setTagLocationName] = useState('');
  const [nfcSupported, setNfcSupported] = useState(false);

  // Add NFC to existing project
  const [showAddNfcModal, setShowAddNfcModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || 
    process.env.EXPO_PUBLIC_BACKEND_URL || '';

  useEffect(() => {
    checkNfcSupport();
    fetchProjects();
  }, [token]);

  const checkNfcSupport = async () => {
    if (Platform.OS === 'web') {
      setNfcSupported(false);
      return;
    }
    try {
      const supported = await NfcManager.isSupported();
      setNfcSupported(supported);
      if (supported) {
        await NfcManager.start();
      }
    } catch (error) {
      console.log('NFC not supported:', error);
      setNfcSupported(false);
    }
  };

  const fetchProjects = async () => {
    if (!token) return;
    
    try {
      const response = await fetch(`${API_URL}/api/projects`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.ok) {
        const data = await response.json();
        setProjects(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.log('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await fetchProjects();
    setRefreshing(false);
  }, [token]);

  // Scan NFC Tag to get its ID
  const scanNfcTag = async () => {
    if (!nfcSupported) {
      Alert.alert('NFC Not Supported', 'This device does not support NFC');
      return;
    }

    setIsScanning(true);
    
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef);
      const tag = await NfcManager.getTag();
      
      if (tag?.id) {
        const tagId = tag.id;
        setCurrentTagId(tagId);
        setShowNfcModal(true);
        
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (error) {
      console.log('NFC Scan error:', error);
      Alert.alert('Scan Failed', 'Could not read NFC tag. Please try again.');
    } finally {
      NfcManager.cancelTechnologyRequest();
      setIsScanning(false);
    }
  };

  // Write URL to NFC tag
  const writeNfcTag = async (projectId: string, tagId: string) => {
    if (!nfcSupported) return false;

    try {
      await NfcManager.requestTechnology(NfcTech.Ndef);
      
      const url = `${API_URL.replace('/api', '')}/nfc?tag=${tagId}`;
      const bytes = Ndef.encodeMessage([Ndef.uriRecord(url)]);
      
      if (bytes) {
        await NfcManager.ndefHandler.writeNdefMessage(bytes);
        return true;
      }
      return false;
    } catch (error) {
      console.log('NFC Write error:', error);
      return false;
    } finally {
      NfcManager.cancelTechnologyRequest();
    }
  };

  // Add scanned tag to list
  const addNfcTag = () => {
    if (!currentTagId) return;
    
    const locationName = tagLocationName.trim() || 'Main Entrance';
    
    // Check for duplicate
    if (nfcTags.some(t => t.tag_id === currentTagId)) {
      Alert.alert('Duplicate', 'This tag is already added');
      return;
    }
    
    setNfcTags([...nfcTags, { 
      tag_id: currentTagId, 
      location_description: locationName 
    }]);
    
    setShowNfcModal(false);
    setCurrentTagId('');
    setTagLocationName('');
    
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  // Remove tag from list
  const removeNfcTag = (tagId: string) => {
    setNfcTags(nfcTags.filter(t => t.tag_id !== tagId));
  };

  // Create project with NFC tags
  const handleAddProject = async () => {
    if (!newProject.name.trim()) {
      Alert.alert('Required', 'Please enter project name');
      return;
    }
    if (!newProject.location.trim()) {
      Alert.alert('Required', 'Please enter project location');
      return;
    }

    setSaving(true);
    try {
      // Create project
      const response = await fetch(`${API_URL}/api/projects`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newProject.name.trim(),
          location: newProject.location.trim(),
          address: newProject.address.trim() || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create project');
      }

      const project = await response.json();

      // Register NFC tags for this project
      for (const tag of nfcTags) {
        await fetch(`${API_URL}/api/nfc-tags`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            project_id: project.id,
            tag_id: tag.tag_id,
            location_description: tag.location_description,
          }),
        });

        // Write URL to tag
        await writeNfcTag(project.id, tag.tag_id);
      }

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      
      setShowAddModal(false);
      setNewProject({ name: '', location: '', address: '' });
      setNfcTags([]);
      
      Alert.alert('Success', `Project created with ${nfcTags.length} NFC tag(s)`);
      fetchProjects();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create project');
    } finally {
      setSaving(false);
    }
  };

  // Add NFC tag to existing project
  const handleAddNfcToProject = async () => {
    if (!selectedProject || !currentTagId) return;

    setSaving(true);
    try {
      const locationName = tagLocationName.trim() || 'Main Entrance';
      
      // Register tag
      const response = await fetch(`${API_URL}/api/nfc-tags`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_id: selectedProject.id,
          tag_id: currentTagId,
          location_description: locationName,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to register tag');
      }

      // Write URL to tag
      await writeNfcTag(selectedProject.id, currentTagId);

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setShowAddNfcModal(false);
      setSelectedProject(null);
      setCurrentTagId('');
      setTagLocationName('');
      
      Alert.alert('Success', 'NFC tag registered and programmed');
      fetchProjects();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProject = (project: Project) => {
    Alert.alert(
      'Delete Project',
      `Are you sure you want to delete "${project.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await fetch(`${API_URL}/api/projects/${project.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              
              if (!response.ok) {
                throw new Error('Failed to delete project');
              }
              
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
              fetchProjects();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete project');
            }
          },
        },
      ]
    );
  };

  const openAddNfcModal = async (project: Project) => {
    setSelectedProject(project);
    setShowAddNfcModal(true);
    
    // Start scanning
    if (nfcSupported) {
      setIsScanning(true);
      try {
        await NfcManager.requestTechnology(NfcTech.Ndef);
        const tag = await NfcManager.getTag();
        
        if (tag?.id) {
          setCurrentTagId(tag.id);
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }
      } catch (error) {
        console.log('NFC Scan error:', error);
      } finally {
        NfcManager.cancelTechnologyRequest();
        setIsScanning(false);
      }
    }
  };

  const renderProject = ({ item }: { item: Project }) => (
    <TouchableOpacity
      style={styles.projectCard}
      onPress={() => router.push(`/project/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.projectIcon}>
        <Ionicons name="business" size={24} color={COLORS.primary} />
      </View>
      
      <View style={styles.projectInfo}>
        <Text style={styles.projectName}>{item.name}</Text>
        <Text style={styles.projectLocation}>{item.location}</Text>
        {item.address && (
          <Text style={styles.projectAddress}>{item.address}</Text>
        )}
        {item.nfc_tags && item.nfc_tags.length > 0 && (
          <View style={styles.nfcBadge}>
            <Ionicons name="wifi" size={12} color={COLORS.success} />
            <Text style={styles.nfcBadgeText}>{item.nfc_tags.length} NFC</Text>
          </View>
        )}
      </View>
      
      <View style={styles.rightSection}>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => openAddNfcModal(item)}
          >
            <Ionicons name="wifi" size={18} color={COLORS.secondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleDeleteProject(item)}
          >
            <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );

  const EmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="business-outline" size={64} color={COLORS.textSecondary} />
      <Text style={styles.emptyTitle}>No Projects Yet</Text>
      <Text style={styles.emptySubtitle}>
        Create your first project to start tracking site operations
      </Text>
      <TouchableOpacity
        style={styles.addFirstButton}
        onPress={() => setShowAddModal(true)}
      >
        <Ionicons name="add" size={20} color={COLORS.text} />
        <Text style={styles.addFirstText}>Create First Project</Text>
      </TouchableOpacity>
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
          <Text style={styles.headerTitle}>Projects</Text>
          <Text style={styles.headerSubtitle}>{projects.length} Sites</Text>
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => {
            if (Platform.OS !== 'web') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }
            setShowAddModal(true);
          }}
        >
          <Ionicons name="add" size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Projects List */}
      <FlatList
        data={projects}
        renderItem={renderProject}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          projects.length === 0 && styles.emptyListContent,
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

      {/* Add Project Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalContainer}
          >
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>New Project</Text>
                <TouchableOpacity onPress={() => {
                  setShowAddModal(false);
                  setNfcTags([]);
                }}>
                  <Ionicons name="close" size={24} color={COLORS.text} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Project Name *</Text>
                  <TextInput
                    style={styles.input}
                    value={newProject.name}
                    onChangeText={(text) =>
                      setNewProject({ ...newProject, name: text })
                    }
                    placeholder="Downtown Tower Phase 2"
                    placeholderTextColor={COLORS.textMuted}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Location *</Text>
                  <TextInput
                    style={styles.input}
                    value={newProject.location}
                    onChangeText={(text) =>
                      setNewProject({ ...newProject, location: text })
                    }
                    placeholder="New York, NY"
                    placeholderTextColor={COLORS.textMuted}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Address (Optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={newProject.address}
                    onChangeText={(text) =>
                      setNewProject({ ...newProject, address: text })
                    }
                    placeholder="123 Main Street"
                    placeholderTextColor={COLORS.textMuted}
                  />
                </View>

                {/* NFC Tags Section */}
                <View style={styles.nfcSection}>
                  <View style={styles.nfcSectionHeader}>
                    <Ionicons name="wifi" size={20} color={COLORS.secondary} />
                    <Text style={styles.nfcSectionTitle}>NFC Check-In Tags</Text>
                  </View>
                  
                  <Text style={styles.nfcSectionDesc}>
                    Tap blank NFC tags to register them for worker check-in
                  </Text>

                  {/* Added Tags */}
                  {nfcTags.map((tag, index) => (
                    <View key={tag.tag_id} style={styles.addedTag}>
                      <View style={styles.addedTagInfo}>
                        <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
                        <View>
                          <Text style={styles.addedTagLocation}>{tag.location_description}</Text>
                          <Text style={styles.addedTagId}>ID: {tag.tag_id.substring(0, 12)}...</Text>
                        </View>
                      </View>
                      <TouchableOpacity onPress={() => removeNfcTag(tag.tag_id)}>
                        <Ionicons name="close-circle" size={24} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  ))}

                  {/* Add Tag Button */}
                  {nfcSupported && (
                    <TouchableOpacity
                      style={[styles.scanTagButton, isScanning && styles.scanTagButtonActive]}
                      onPress={scanNfcTag}
                      disabled={isScanning}
                    >
                      {isScanning ? (
                        <>
                          <ActivityIndicator size="small" color={COLORS.text} />
                          <Text style={styles.scanTagButtonText}>Scanning... Hold tag to phone</Text>
                        </>
                      ) : (
                        <>
                          <Ionicons name="add-circle" size={24} color={COLORS.text} />
                          <Text style={styles.scanTagButtonText}>Tap to Add NFC Tag</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}

                  {!nfcSupported && Platform.OS !== 'web' && (
                    <Text style={styles.nfcNotSupported}>NFC not supported on this device</Text>
                  )}
                </View>

                <TouchableOpacity
                  style={[
                    styles.createButton,
                    saving && styles.createButtonDisabled,
                  ]}
                  onPress={handleAddProject}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color={COLORS.text} />
                  ) : (
                    <>
                      <Ionicons name="add-circle" size={20} color={COLORS.text} />
                      <Text style={styles.createButtonText}>Create Project</Text>
                    </>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Name Tag Modal */}
      <Modal
        visible={showNfcModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowNfcModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.tagNameModal}>
            <View style={styles.tagNameHeader}>
              <Ionicons name="checkmark-circle" size={48} color={COLORS.success} />
              <Text style={styles.tagNameTitle}>Tag Detected!</Text>
              <Text style={styles.tagNameId}>ID: {currentTagId.substring(0, 16)}...</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Location Name</Text>
              <TextInput
                style={styles.input}
                value={tagLocationName}
                onChangeText={setTagLocationName}
                placeholder="e.g., Main Entrance, Floor 3"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>

            <View style={styles.tagNameActions}>
              <TouchableOpacity
                style={styles.tagNameCancel}
                onPress={() => {
                  setShowNfcModal(false);
                  setCurrentTagId('');
                  setTagLocationName('');
                }}
              >
                <Text style={styles.tagNameCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.tagNameConfirm}
                onPress={addNfcTag}
              >
                <Text style={styles.tagNameConfirmText}>Add Tag</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add NFC to Existing Project Modal */}
      <Modal
        visible={showAddNfcModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowAddNfcModal(false);
          setSelectedProject(null);
          setCurrentTagId('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.addNfcModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add NFC Tag</Text>
              <TouchableOpacity onPress={() => {
                setShowAddNfcModal(false);
                setSelectedProject(null);
                setCurrentTagId('');
              }}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            {selectedProject && (
              <Text style={styles.addNfcProjectName}>Project: {selectedProject.name}</Text>
            )}

            <View style={styles.addNfcContent}>
              {isScanning ? (
                <View style={styles.scanningState}>
                  <ActivityIndicator size="large" color={COLORS.secondary} />
                  <Text style={styles.scanningText}>Hold NFC tag to back of phone...</Text>
                </View>
              ) : currentTagId ? (
                <View style={styles.tagDetectedState}>
                  <Ionicons name="checkmark-circle" size={64} color={COLORS.success} />
                  <Text style={styles.tagDetectedText}>Tag Detected!</Text>
                  <Text style={styles.tagDetectedId}>ID: {currentTagId.substring(0, 16)}...</Text>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Location Name</Text>
                    <TextInput
                      style={styles.input}
                      value={tagLocationName}
                      onChangeText={setTagLocationName}
                      placeholder="e.g., Main Entrance"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>

                  <TouchableOpacity
                    style={[styles.createButton, saving && styles.createButtonDisabled]}
                    onPress={handleAddNfcToProject}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator color={COLORS.text} />
                    ) : (
                      <Text style={styles.createButtonText}>Register & Program Tag</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.readyToScan}>
                  <Ionicons name="wifi" size={64} color={COLORS.secondary} />
                  <Text style={styles.readyToScanText}>Ready to scan</Text>
                  <TouchableOpacity style={styles.startScanButton} onPress={() => openAddNfcModal(selectedProject!)}>
                    <Text style={styles.startScanButtonText}>Tap to Start Scanning</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
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
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
  },
  emptyListContent: {
    flex: 1,
  },
  projectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  projectIcon: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: COLORS.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  projectInfo: {
    flex: 1,
    marginLeft: 12,
  },
  projectName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  projectLocation: {
    fontSize: 14,
    color: COLORS.secondary,
    marginTop: 2,
  },
  projectAddress: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  nfcBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.success + '20',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginTop: 6,
    alignSelf: 'flex-start',
    gap: 4,
  },
  nfcBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.success,
  },
  rightSection: {
    alignItems: 'flex-end',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
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
    flexDirection: 'row',
    alignItems: 'center',
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
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    width: '100%',
    maxHeight: '90%',
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    maxHeight: '100%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
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
  nfcSection: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  nfcSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  nfcSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  nfcSectionDesc: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  addedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  addedTagInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addedTagLocation: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  addedTagId: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  scanTagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.secondary,
    borderRadius: 10,
    paddingVertical: 14,
    gap: 8,
  },
  scanTagButtonActive: {
    backgroundColor: COLORS.warning,
  },
  scanTagButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  nfcNotSupported: {
    fontSize: 13,
    color: COLORS.danger,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 8,
    gap: 8,
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  tagNameModal: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 24,
    marginHorizontal: 20,
    marginTop: 'auto',
    marginBottom: 'auto',
  },
  tagNameHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  tagNameTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 12,
  },
  tagNameId: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  tagNameActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  tagNameCancel: {
    flex: 1,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tagNameCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  tagNameConfirm: {
    flex: 1,
    backgroundColor: COLORS.success,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tagNameConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  addNfcModal: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  addNfcProjectName: {
    fontSize: 14,
    color: COLORS.secondary,
    marginBottom: 20,
  },
  addNfcContent: {
    minHeight: 250,
  },
  scanningState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  scanningText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 16,
  },
  tagDetectedState: {
    alignItems: 'center',
    paddingTop: 20,
  },
  tagDetectedText: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.success,
    marginTop: 12,
  },
  tagDetectedId: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
    marginBottom: 20,
  },
  readyToScan: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  readyToScanText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 12,
  },
  startScanButton: {
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 20,
  },
  startScanButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
});
