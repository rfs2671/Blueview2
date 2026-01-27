import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
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

export default function QRScannerScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [matchedProject, setMatchedProject] = useState<Project | null>(null);
  const [showWorkerPicker, setShowWorkerPicker] = useState(false);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [projectsData, workersData] = await Promise.all([
        api.getProjects(),
        api.getWorkers(),
      ]);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setWorkers(Array.isArray(workersData) ? workersData : []);
    } catch (error) {
      console.log('Error fetching data:', error);
    }
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    setScanning(false);

    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    // Try to find a matching project by QR code
    const project = projects.find(
      (p) => p.qr_code.toUpperCase() === data.toUpperCase()
    );

    if (project) {
      setMatchedProject(project);
      setShowWorkerPicker(true);
    } else {
      Alert.alert(
        'Unknown QR Code',
        `No project found for code: ${data}`,
        [
          {
            text: 'Scan Again',
            onPress: () => {
              setScanned(false);
              setScanning(true);
            },
          },
          {
            text: 'Go Back',
            onPress: () => router.back(),
          },
        ]
      );
    }
  };

  const handleWorkerCheckIn = async (worker: Worker) => {
    if (!matchedProject) return;

    try {
      await api.createCheckin({
        worker_id: worker.id,
        project_id: matchedProject.id,
      });
      
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      
      setShowWorkerPicker(false);
      Alert.alert(
        'Check-In Successful',
        `${worker.name} has been checked in to ${matchedProject.name}`,
        [
          {
            text: 'Check In Another',
            onPress: () => {
              setScanned(false);
              setScanning(true);
              setMatchedProject(null);
            },
          },
          {
            text: 'Done',
            onPress: () => router.back(),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Error', error?.detail || 'Failed to check in worker');
    }
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>Loading camera...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.permissionContainer}>
          <Ionicons name="camera-outline" size={64} color={COLORS.textSecondary} />
          <Text style={styles.permissionTitle}>Camera Permission Required</Text>
          <Text style={styles.permissionText}>
            We need camera access to scan QR codes for worker check-in
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
            <Text style={styles.backLinkText}>Go Back</Text>
          </TouchableOpacity>
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
        <Text style={styles.headerTitle}>Scan QR Code</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Camera */}
      <View style={styles.cameraContainer}>
        {scanning && (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{
              barcodeTypes: ['qr'],
            }}
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          >
            <View style={styles.overlay}>
              <View style={styles.scanArea}>
                <View style={[styles.corner, styles.topLeft]} />
                <View style={[styles.corner, styles.topRight]} />
                <View style={[styles.corner, styles.bottomLeft]} />
                <View style={[styles.corner, styles.bottomRight]} />
              </View>
            </View>
          </CameraView>
        )}
      </View>

      {/* Instructions */}
      <View style={styles.instructions}>
        <Ionicons name="qr-code" size={24} color={COLORS.primary} />
        <Text style={styles.instructionText}>
          Point camera at a project QR code to check in workers
        </Text>
      </View>

      {/* Manual Entry Button */}
      <TouchableOpacity
        style={styles.manualButton}
        onPress={() => router.push('/checkin')}
      >
        <Ionicons name="list" size={20} color={COLORS.text} />
        <Text style={styles.manualButtonText}>Manual Check-In</Text>
      </TouchableOpacity>

      {/* Worker Picker Modal */}
      <Modal
        visible={showWorkerPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowWorkerPicker(false);
          setScanned(false);
          setScanning(true);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Check-In Worker</Text>
                {matchedProject && (
                  <Text style={styles.modalSubtitle}>
                    at {matchedProject.name}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                onPress={() => {
                  setShowWorkerPicker(false);
                  setScanned(false);
                  setScanning(true);
                }}
              >
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={workers}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.workerItem}
                  onPress={() => handleWorkerCheckIn(item)}
                >
                  <View style={styles.workerAvatar}>
                    <Text style={styles.avatarText}>
                      {item.name.split(' ').map((n) => n[0]).join('').toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.workerInfo}>
                    <Text style={styles.workerName}>{item.name}</Text>
                    <Text style={styles.workerTrade}>
                      {item.trade} • {item.company}
                    </Text>
                  </View>
                  <Ionicons name="add-circle" size={28} color={COLORS.success} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyList}>
                  <Text style={styles.emptyText}>No workers available</Text>
                  <TouchableOpacity
                    style={styles.addWorkerButton}
                    onPress={() => {
                      setShowWorkerPicker(false);
                      router.push('/workers/add');
                    }}
                  >
                    <Text style={styles.addWorkerText}>Add Worker</Text>
                  </TouchableOpacity>
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  cameraContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanArea: {
    width: 250,
    height: 250,
    backgroundColor: 'transparent',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: COLORS.primary,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  instructions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 10,
  },
  instructionText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  manualButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 14,
    borderRadius: 12,
    gap: 8,
  },
  manualButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 16,
  },
  permissionText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  permissionButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  backLink: {
    marginTop: 16,
  },
  backLinkText: {
    fontSize: 15,
    color: COLORS.secondary,
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
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  modalSubtitle: {
    fontSize: 14,
    color: COLORS.secondary,
    marginTop: 4,
  },
  workerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    marginBottom: 8,
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
  emptyList: {
    alignItems: 'center',
    padding: 30,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  addWorkerButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
  },
  addWorkerText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
});
