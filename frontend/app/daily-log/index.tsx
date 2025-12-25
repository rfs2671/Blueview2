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
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/colors';
import { api } from '../../src/utils/api';
import { format } from 'date-fns';
import PhotoMarkup from '../../src/components/PhotoMarkup';
import VoiceInput from '../../src/components/VoiceInput';

interface Project {
  id: string;
  name: string;
  location: string;
  qr_code: string;
}

interface Photo {
  image: string;
  description?: string;
}

interface SubcontractorCard {
  company_name: string;
  worker_count: number;
  photos: Photo[];
  work_description?: string;
  inspection: {
    cleanliness: 'pass' | 'fail';
    safety: 'pass' | 'fail';
    comments?: string;
  };
}

interface DailyLog {
  id?: string;
  project_id: string;
  log_date: string;
  weather_conditions?: string;
  subcontractor_cards: SubcontractorCard[];
  notes?: string;
  status?: string;
}

const WEATHER_OPTIONS = [
  'Sunny',
  'Partly Cloudy',
  'Cloudy',
  'Rainy',
  'Stormy',
  'Windy',
  'Hot',
  'Cold',
  'Snow',
];

export default function DailyLogScreen() {
  const router = useRouter();
  const { projectId } = useLocalSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [showWeatherPicker, setShowWeatherPicker] = useState(false);
  const [dailyLog, setDailyLog] = useState<DailyLog | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedCard, setExpandedCard] = useState<number | null>(null);
  const [showAddCard, setShowAddCard] = useState(false);
  const [newCardCompany, setNewCardCompany] = useState('');
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [activeCardIndex, setActiveCardIndex] = useState<number | null>(null);
  const [photoDescription, setPhotoDescription] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [showMarkup, setShowMarkup] = useState(false);

  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      fetchOrCreateDailyLog();
    }
  }, [selectedProject]);

  const fetchInitialData = async () => {
    try {
      const projectsData = await api.getProjects();
      setProjects(Array.isArray(projectsData) ? projectsData : []);

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

  const fetchOrCreateDailyLog = async () => {
    if (!selectedProject) return;
    try {
      let log = await api.getDailyLogByDate(selectedProject.id, today);
      
      if (!log) {
        // Fetch worker stats and auto-create cards
        const stats = await api.getCheckinStats(selectedProject.id);
        const cards: SubcontractorCard[] = Array.isArray(stats) 
          ? stats.map((s: any) => ({
              company_name: s.company,
              worker_count: s.worker_count,
              photos: [],
              work_description: '',
              inspection: {
                cleanliness: 'pass' as const,
                safety: 'pass' as const,
              },
            }))
          : [];

        log = {
          project_id: selectedProject.id,
          log_date: today,
          weather_conditions: '',
          subcontractor_cards: cards,
          notes: '',
        };
      }
      setDailyLog(log);
    } catch (error) {
      console.log('Error fetching daily log:', error);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await fetchOrCreateDailyLog();
    setRefreshing(false);
  }, [selectedProject]);

  const saveDailyLog = async () => {
    if (!dailyLog || !selectedProject) return;

    setSaving(true);
    try {
      if (dailyLog.id) {
        await api.updateDailyLog(dailyLog.id, {
          weather_conditions: dailyLog.weather_conditions,
          subcontractor_cards: dailyLog.subcontractor_cards,
          notes: dailyLog.notes,
        });
      } else {
        const result = await api.createDailyLog({
          project_id: selectedProject.id,
          log_date: today,
          weather_conditions: dailyLog.weather_conditions,
          subcontractor_cards: dailyLog.subcontractor_cards,
          notes: dailyLog.notes,
        });
        setDailyLog({ ...dailyLog, id: result.id });
      }
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert('Saved', 'Daily log saved successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to save daily log');
    } finally {
      setSaving(false);
    }
  };

  const submitDailyLog = async () => {
    if (!dailyLog?.id) {
      Alert.alert('Error', 'Please save the log first');
      return;
    }

    Alert.alert(
      'Submit Daily Log',
      'Are you sure you want to submit this log? It cannot be edited after submission.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            try {
              await api.submitDailyLog(dailyLog.id!);
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
              Alert.alert('Success', 'Daily log submitted successfully');
              fetchOrCreateDailyLog();
            } catch (error) {
              Alert.alert('Error', 'Failed to submit daily log');
            }
          },
        },
      ]
    );
  };

  const addSubcontractorCard = () => {
    if (!newCardCompany.trim()) {
      Alert.alert('Required', 'Please enter company name');
      return;
    }

    const newCard: SubcontractorCard = {
      company_name: newCardCompany.trim(),
      worker_count: 0,
      photos: [],
      work_description: '',
      inspection: {
        cleanliness: 'pass',
        safety: 'pass',
      },
    };

    setDailyLog({
      ...dailyLog!,
      subcontractor_cards: [...(dailyLog?.subcontractor_cards || []), newCard],
    });
    setNewCardCompany('');
    setShowAddCard(false);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  };

  const updateCard = (index: number, updates: Partial<SubcontractorCard>) => {
    if (!dailyLog) return;
    const cards = [...dailyLog.subcontractor_cards];
    cards[index] = { ...cards[index], ...updates };
    setDailyLog({ ...dailyLog, subcontractor_cards: cards });
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      setSelectedPhoto(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Camera permission is needed to take photos');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      setSelectedPhoto(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const addPhotoToCard = () => {
    if (activeCardIndex === null || !selectedPhoto) return;

    const newPhoto: Photo = {
      image: selectedPhoto,
      description: photoDescription,
    };

    const cards = [...(dailyLog?.subcontractor_cards || [])];
    cards[activeCardIndex].photos = [...(cards[activeCardIndex].photos || []), newPhoto];
    setDailyLog({ ...dailyLog!, subcontractor_cards: cards });
    
    setShowPhotoModal(false);
    setSelectedPhoto(null);
    setPhotoDescription('');
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const toggleInspection = (cardIndex: number, field: 'cleanliness' | 'safety') => {
    if (!dailyLog) return;
    const cards = [...dailyLog.subcontractor_cards];
    const current = cards[cardIndex].inspection[field];
    cards[cardIndex].inspection[field] = current === 'pass' ? 'fail' : 'pass';
    setDailyLog({ ...dailyLog, subcontractor_cards: cards });
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
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

  const isSubmitted = dailyLog?.status === 'submitted';

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
          <Text style={styles.headerTitle}>Super Daily Log</Text>
          <Text style={styles.headerSubtitle}>{format(new Date(), 'MMM d, yyyy')}</Text>
        </View>
        {!isSubmitted && (
          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={saveDailyLog}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={COLORS.text} />
            ) : (
              <Ionicons name="cloud-upload" size={22} color={COLORS.text} />
            )}
          </TouchableOpacity>
        )}
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
        <Ionicons name="chevron-down" size={20} color={COLORS.textSecondary} />
      </TouchableOpacity>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Weather Conditions */}
        <TouchableOpacity
          style={styles.weatherCard}
          onPress={() => !isSubmitted && setShowWeatherPicker(true)}
          disabled={isSubmitted}
        >
          <View style={styles.weatherLeft}>
            <Ionicons name="partly-sunny" size={24} color={COLORS.warning} />
            <View>
              <Text style={styles.weatherLabel}>Weather Conditions</Text>
              <Text style={styles.weatherValue}>
                {dailyLog?.weather_conditions || 'Tap to set'}
              </Text>
            </View>
          </View>
          {!isSubmitted && <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />}
        </TouchableOpacity>

        {/* Status Badge */}
        {isSubmitted && (
          <View style={styles.statusBadge}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
            <Text style={styles.statusText}>Submitted</Text>
          </View>
        )}

        {/* Subcontractor Cards Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Subcontractor Cards</Text>
            {!isSubmitted && (
              <TouchableOpacity
                style={styles.addCardButton}
                onPress={() => setShowAddCard(true)}
              >
                <Ionicons name="add" size={20} color={COLORS.text} />
              </TouchableOpacity>
            )}
          </View>

          {dailyLog?.subcontractor_cards.map((card, index) => (
            <View key={index} style={styles.subCard}>
              <TouchableOpacity
                style={styles.subCardHeader}
                onPress={() => setExpandedCard(expandedCard === index ? null : index)}
              >
                <View style={styles.subCardLeft}>
                  <View style={styles.companyBadge}>
                    <Text style={styles.companyInitial}>
                      {card.company_name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View>
                    <Text style={styles.companyName}>{card.company_name}</Text>
                    <Text style={styles.workerCount}>
                      {card.worker_count} workers • {card.photos.length} photos
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name={expandedCard === index ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={COLORS.textSecondary}
                />
              </TouchableOpacity>

              {expandedCard === index && (
                <View style={styles.subCardContent}>
                  {/* Photos Section */}
                  <View style={styles.photosSection}>
                    <Text style={styles.subLabel}>Photos</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.photoRow}>
                        {card.photos.map((photo, photoIndex) => (
                          <View key={photoIndex} style={styles.photoThumb}>
                            <Image
                              source={{ uri: photo.image }}
                              style={styles.photoImage}
                            />
                          </View>
                        ))}
                        {!isSubmitted && (
                          <TouchableOpacity
                            style={styles.addPhotoButton}
                            onPress={() => {
                              setActiveCardIndex(index);
                              setShowPhotoModal(true);
                            }}
                          >
                            <Ionicons name="camera" size={24} color={COLORS.primary} />
                            <Text style={styles.addPhotoText}>Add</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </ScrollView>
                  </View>

                  {/* Work Description */}
                  <View style={styles.descriptionSection}>
                    <Text style={styles.subLabel}>Work Performed Today</Text>
                    <TextInput
                      style={styles.descriptionInput}
                      value={card.work_description}
                      onChangeText={(text) => updateCard(index, { work_description: text })}
                      placeholder="Describe work performed..."
                      placeholderTextColor={COLORS.textMuted}
                      multiline
                      editable={!isSubmitted}
                    />
                  </View>

                  {/* Inspections */}
                  <View style={styles.inspectionSection}>
                    <Text style={styles.subLabel}>Site Inspection</Text>
                    <View style={styles.inspectionRow}>
                      <TouchableOpacity
                        style={[
                          styles.inspectionToggle,
                          card.inspection.cleanliness === 'pass'
                            ? styles.inspectionPass
                            : styles.inspectionFail,
                        ]}
                        onPress={() => !isSubmitted && toggleInspection(index, 'cleanliness')}
                        disabled={isSubmitted}
                      >
                        <Ionicons
                          name={card.inspection.cleanliness === 'pass' ? 'checkmark-circle' : 'close-circle'}
                          size={20}
                          color={card.inspection.cleanliness === 'pass' ? COLORS.success : COLORS.danger}
                        />
                        <Text style={styles.inspectionLabel}>Cleanliness</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.inspectionToggle,
                          card.inspection.safety === 'pass'
                            ? styles.inspectionPass
                            : styles.inspectionFail,
                        ]}
                        onPress={() => !isSubmitted && toggleInspection(index, 'safety')}
                        disabled={isSubmitted}
                      >
                        <Ionicons
                          name={card.inspection.safety === 'pass' ? 'checkmark-circle' : 'close-circle'}
                          size={20}
                          color={card.inspection.safety === 'pass' ? COLORS.success : COLORS.danger}
                        />
                        <Text style={styles.inspectionLabel}>Safety</Text>
                      </TouchableOpacity>
                    </View>

                    {(card.inspection.cleanliness === 'fail' || card.inspection.safety === 'fail') && (
                      <TextInput
                        style={styles.commentsInput}
                        value={card.inspection.comments}
                        onChangeText={(text) => {
                          const cards = [...(dailyLog?.subcontractor_cards || [])];
                          cards[index].inspection.comments = text;
                          setDailyLog({ ...dailyLog!, subcontractor_cards: cards });
                        }}
                        placeholder="Add comments about the issues..."
                        placeholderTextColor={COLORS.textMuted}
                        multiline
                        editable={!isSubmitted}
                      />
                    )}
                  </View>
                </View>
              )}
            </View>
          ))}

          {dailyLog?.subcontractor_cards.length === 0 && (
            <View style={styles.emptyCards}>
              <Text style={styles.emptyCardsText}>
                No subcontractor cards yet. Add one to document work.
              </Text>
            </View>
          )}
        </View>

        {/* Notes Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Additional Notes</Text>
          <TextInput
            style={styles.notesInput}
            value={dailyLog?.notes}
            onChangeText={(text) => setDailyLog({ ...dailyLog!, notes: text })}
            placeholder="Any additional notes for today..."
            placeholderTextColor={COLORS.textMuted}
            multiline
            editable={!isSubmitted}
          />
        </View>

        {/* Submit Button */}
        {!isSubmitted && dailyLog?.id && (
          <TouchableOpacity
            style={styles.submitButton}
            onPress={submitDailyLog}
          >
            <Ionicons name="send" size={20} color={COLORS.text} />
            <Text style={styles.submitButtonText}>Submit Daily Log</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

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
            <ScrollView>
              {projects.map((project) => (
                <TouchableOpacity
                  key={project.id}
                  style={[
                    styles.pickerItem,
                    selectedProject?.id === project.id && styles.pickerItemSelected,
                  ]}
                  onPress={() => {
                    setSelectedProject(project);
                    setShowProjectPicker(false);
                  }}
                >
                  <Text style={styles.pickerItemTitle}>{project.name}</Text>
                  {selectedProject?.id === project.id && (
                    <Ionicons name="checkmark" size={24} color={COLORS.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Weather Picker Modal */}
      <Modal
        visible={showWeatherPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowWeatherPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Weather Conditions</Text>
              <TouchableOpacity onPress={() => setShowWeatherPicker(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.weatherGrid}>
              {WEATHER_OPTIONS.map((weather) => (
                <TouchableOpacity
                  key={weather}
                  style={[
                    styles.weatherOption,
                    dailyLog?.weather_conditions === weather && styles.weatherOptionSelected,
                  ]}
                  onPress={() => {
                    setDailyLog({ ...dailyLog!, weather_conditions: weather });
                    setShowWeatherPicker(false);
                    if (Platform.OS !== 'web') {
                      Haptics.selectionAsync();
                    }
                  }}
                >
                  <Text
                    style={[
                      styles.weatherOptionText,
                      dailyLog?.weather_conditions === weather && styles.weatherOptionTextSelected,
                    ]}
                  >
                    {weather}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Card Modal */}
      <Modal
        visible={showAddCard}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddCard(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Subcontractor</Text>
              <TouchableOpacity onPress={() => setShowAddCard(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.addCardInput}
              value={newCardCompany}
              onChangeText={setNewCardCompany}
              placeholder="Company Name"
              placeholderTextColor={COLORS.textMuted}
              autoFocus
            />
            <TouchableOpacity
              style={styles.addCardSubmit}
              onPress={addSubcontractorCard}
            >
              <Text style={styles.addCardSubmitText}>Add Card</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Photo Modal */}
      <Modal
        visible={showPhotoModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowPhotoModal(false);
          setSelectedPhoto(null);
          setPhotoDescription('');
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.photoModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Photo</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowPhotoModal(false);
                  setSelectedPhoto(null);
                  setPhotoDescription('');
                }}
              >
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            {!selectedPhoto ? (
              <View style={styles.photoOptions}>
                <TouchableOpacity style={styles.photoOption} onPress={takePhoto}>
                  <Ionicons name="camera" size={40} color={COLORS.primary} />
                  <Text style={styles.photoOptionText}>Take Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.photoOption} onPress={pickImage}>
                  <Ionicons name="images" size={40} color={COLORS.secondary} />
                  <Text style={styles.photoOptionText}>Choose from Gallery</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Image source={{ uri: selectedPhoto }} style={styles.photoPreview} />
                <TextInput
                  style={styles.photoDescInput}
                  value={photoDescription}
                  onChangeText={setPhotoDescription}
                  placeholder="Add description (optional)"
                  placeholderTextColor={COLORS.textMuted}
                />
                <View style={styles.photoActions}>
                  <TouchableOpacity
                    style={styles.photoRetake}
                    onPress={() => setSelectedPhoto(null)}
                  >
                    <Text style={styles.photoRetakeText}>Retake</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.photoSave} onPress={addPhotoToCard}>
                    <Text style={styles.photoSaveText}>Add Photo</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
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
  saveButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  weatherCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  weatherLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  weatherLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  weatherValue: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.success + '20',
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
    gap: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.success,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  addCardButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  subCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  subCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  subCardContent: {
    padding: 14,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  photosSection: {
    marginBottom: 16,
  },
  subLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
    marginTop: 10,
  },
  photoRow: {
    flexDirection: 'row',
    gap: 10,
  },
  photoThumb: {
    width: 70,
    height: 70,
    borderRadius: 8,
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  addPhotoButton: {
    width: 70,
    height: 70,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
  },
  addPhotoText: {
    fontSize: 11,
    color: COLORS.primary,
    marginTop: 4,
  },
  descriptionSection: {
    marginBottom: 16,
  },
  descriptionInput: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: COLORS.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  inspectionSection: {},
  inspectionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inspectionToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
  inspectionPass: {
    backgroundColor: COLORS.success + '20',
  },
  inspectionFail: {
    backgroundColor: COLORS.danger + '20',
  },
  inspectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  commentsInput: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: COLORS.text,
    marginTop: 10,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  emptyCards: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 30,
    alignItems: 'center',
  },
  emptyCardsText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  notesInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 100,
    textAlignVertical: 'top',
    marginTop: 8,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.success,
    borderRadius: 12,
    paddingVertical: 16,
    gap: 8,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
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
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: COLORS.surfaceLight,
  },
  pickerItemSelected: {
    backgroundColor: COLORS.primary + '20',
  },
  pickerItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  weatherGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  weatherOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.surfaceLight,
  },
  weatherOptionSelected: {
    backgroundColor: COLORS.primary,
  },
  weatherOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  weatherOptionTextSelected: {
    color: COLORS.text,
  },
  addCardInput: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 16,
  },
  addCardSubmit: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  addCardSubmitText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  photoModalContent: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  photoOptions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 30,
  },
  photoOption: {
    alignItems: 'center',
    gap: 10,
  },
  photoOptionText: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  photoPreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 16,
  },
  photoDescInput: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: COLORS.text,
    marginBottom: 16,
  },
  photoActions: {
    flexDirection: 'row',
    gap: 12,
  },
  photoRetake: {
    flex: 1,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  photoRetakeText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  photoSave: {
    flex: 1,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  photoSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
});
