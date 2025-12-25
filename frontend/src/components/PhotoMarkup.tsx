import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  PanResponder,
  GestureResponderEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import ViewShot from 'react-native-view-shot';
import { COLORS } from '../constants/colors';

interface PhotoMarkupProps {
  imageUri: string;
  onSave: (markedImageUri: string) => void;
  onCancel: () => void;
}

type MarkupTool = 'circle' | 'arrow' | 'freehand';

interface DrawElement {
  type: MarkupTool;
  startX: number;
  startY: number;
  endX?: number;
  endY?: number;
  path?: string;
  color: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IMAGE_WIDTH = SCREEN_WIDTH - 40;
const IMAGE_HEIGHT = 300;

export default function PhotoMarkup({ imageUri, onSave, onCancel }: PhotoMarkupProps) {
  const [selectedTool, setSelectedTool] = useState<MarkupTool>('circle');
  const [selectedColor, setSelectedColor] = useState('#FF0000');
  const [elements, setElements] = useState<DrawElement[]>([]);
  const [currentElement, setCurrentElement] = useState<DrawElement | null>(null);
  const viewShotRef = useRef<ViewShot>(null);

  const colors = ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#FFFFFF'];

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        const newElement: DrawElement = {
          type: selectedTool,
          startX: locationX,
          startY: locationY,
          color: selectedColor,
          path: selectedTool === 'freehand' ? `M${locationX},${locationY}` : undefined,
        };
        setCurrentElement(newElement);
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        if (!currentElement) return;
        const { locationX, locationY } = evt.nativeEvent;
        
        if (currentElement.type === 'freehand') {
          setCurrentElement({
            ...currentElement,
            path: `${currentElement.path} L${locationX},${locationY}`,
          });
        } else {
          setCurrentElement({
            ...currentElement,
            endX: locationX,
            endY: locationY,
          });
        }
      },
      onPanResponderRelease: () => {
        if (currentElement) {
          setElements([...elements, currentElement]);
          setCurrentElement(null);
        }
      },
    })
  ).current;

  const renderElement = (element: DrawElement, index: number) => {
    switch (element.type) {
      case 'circle':
        if (!element.endX || !element.endY) return null;
        const radius = Math.sqrt(
          Math.pow(element.endX - element.startX, 2) +
          Math.pow(element.endY - element.startY, 2)
        );
        return (
          <Circle
            key={index}
            cx={element.startX}
            cy={element.startY}
            r={radius}
            stroke={element.color}
            strokeWidth={3}
            fill="none"
          />
        );
      case 'arrow':
        if (!element.endX || !element.endY) return null;
        const angle = Math.atan2(
          element.endY - element.startY,
          element.endX - element.startX
        );
        const arrowLength = 15;
        const arrowAngle = Math.PI / 6;
        const x1 = element.endX - arrowLength * Math.cos(angle - arrowAngle);
        const y1 = element.endY - arrowLength * Math.sin(angle - arrowAngle);
        const x2 = element.endX - arrowLength * Math.cos(angle + arrowAngle);
        const y2 = element.endY - arrowLength * Math.sin(angle + arrowAngle);
        return (
          <React.Fragment key={index}>
            <Line
              x1={element.startX}
              y1={element.startY}
              x2={element.endX}
              y2={element.endY}
              stroke={element.color}
              strokeWidth={3}
            />
            <Line
              x1={element.endX}
              y1={element.endY}
              x2={x1}
              y2={y1}
              stroke={element.color}
              strokeWidth={3}
            />
            <Line
              x1={element.endX}
              y1={element.endY}
              x2={x2}
              y2={y2}
              stroke={element.color}
              strokeWidth={3}
            />
          </React.Fragment>
        );
      case 'freehand':
        if (!element.path) return null;
        return (
          <Path
            key={index}
            d={element.path}
            stroke={element.color}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      default:
        return null;
    }
  };

  const handleUndo = () => {
    setElements(elements.slice(0, -1));
  };

  const handleClear = () => {
    setElements([]);
  };

  const handleSave = async () => {
    try {
      if (viewShotRef.current?.capture) {
        const uri = await viewShotRef.current.capture();
        onSave(`data:image/png;base64,${uri}`);
      }
    } catch (error) {
      console.log('Error saving markup:', error);
    }
  };

  const ToolButton = ({ tool, icon }: { tool: MarkupTool; icon: keyof typeof Ionicons.glyphMap }) => (
    <TouchableOpacity
      style={[
        styles.toolButton,
        selectedTool === tool && styles.toolButtonActive,
      ]}
      onPress={() => setSelectedTool(tool)}
    >
      <Ionicons
        name={icon}
        size={22}
        color={selectedTool === tool ? COLORS.text : COLORS.textSecondary}
      />
    </TouchableOpacity>
  );

  return (
    <View style={styles.overlay}>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Mark Up Photo</Text>
            <TouchableOpacity onPress={onCancel}>
              <Ionicons name="close" size={28} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          {/* Image with markup */}
          <ViewShot
            ref={viewShotRef}
            options={{ format: 'png', quality: 1, result: 'base64' }}
          >
            <View
              style={styles.imageContainer}
              {...panResponder.panHandlers}
            >
              <Image
                source={{ uri: imageUri }}
                style={styles.image}
                resizeMode="contain"
              />
              <Svg style={StyleSheet.absoluteFill}>
                {elements.map((el, idx) => renderElement(el, idx))}
                {currentElement && renderElement(currentElement, -1)}
              </Svg>
            </View>
          </ViewShot>

          {/* Tools */}
          <View style={styles.toolsRow}>
            <ToolButton tool="circle" icon="ellipse-outline" />
            <ToolButton tool="arrow" icon="arrow-forward" />
            <ToolButton tool="freehand" icon="brush" />
            <View style={styles.divider} />
            <TouchableOpacity style={styles.toolButton} onPress={handleUndo}>
              <Ionicons name="arrow-undo" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolButton} onPress={handleClear}>
              <Ionicons name="trash-outline" size={22} color={COLORS.danger} />
            </TouchableOpacity>
          </View>

          {/* Colors */}
          <View style={styles.colorsRow}>
            {colors.map((color) => (
              <TouchableOpacity
                key={color}
                style={[
                  styles.colorButton,
                  { backgroundColor: color },
                  selectedColor === color && styles.colorButtonActive,
                ]}
                onPress={() => setSelectedColor(color)}
              />
            ))}
          </View>

          {/* Actions */}
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Ionicons name="checkmark" size={20} color={COLORS.text} />
              <Text style={styles.saveText}>Save Markup</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    zIndex: 1000,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  imageContainer: {
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    backgroundColor: '#000',
    borderRadius: 12,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  toolsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  toolButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolButtonActive: {
    backgroundColor: COLORS.primary,
  },
  divider: {
    width: 1,
    height: 30,
    backgroundColor: COLORS.border,
    marginHorizontal: 8,
  },
  colorsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    gap: 12,
  },
  colorButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorButtonActive: {
    borderColor: COLORS.text,
    borderWidth: 3,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  saveText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
});
