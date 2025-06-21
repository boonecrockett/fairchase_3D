import * as THREE from 'three';
import { gameContext } from './context.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class Animal {
    constructor(config) {
        this.config = config;
        this.model = new THREE.Group();
        this.model.name = config.name || 'animal';
        this.isModelLoaded = !config.modelPath;
        this.mixer = null;
        this.animations = {};
        this.activeAction = null;
        this.pendingSpawn = false;

        this.state = 'IDLE';
        this.stateTimer = 0;

        if (config.modelPath) {
            this.loadModel(config.modelPath);
        } else {
            this.createBody();
            this.createLegs();
            this.createHead(); // Includes neck
        }
    }

    loadModel(path) {
        const loader = new GLTFLoader();
        loader.load(path, (gltf) => {
            const loadedScene = gltf.scene;

            // Configure the loaded model's scale, position, and rotation.
            loadedScene.scale.set(this.config.scale, this.config.scale, this.config.scale);
            // Apply 90-degree clockwise rotation for correct travel orientation
            loadedScene.rotation.y = -Math.PI / 2; // 90 degrees clockwise
            loadedScene.position.y = this.config.yOffset || 0;

            let bodyMesh = null;
            loadedScene.traverse((child) => {
                if (child.isMesh) {
                    // The first mesh found is assumed to be the main body.
                    if (!bodyMesh) bodyMesh = child;
                    child.name = 'body'; // Name all meshes 'body' for simplicity.
                    child.castShadow = true; // Enable shadows for all meshes
                    child.receiveShadow = true;
                }
            });

            // Add the configured scene to the main model group.
            this.model.add(loadedScene);

            // Create vitals hitbox and attach it to the identified body mesh.
            if (this.config.vitals && bodyMesh) {
                this.createVitals(bodyMesh);
            }

            // Set up the animation mixer.
            this.mixer = new THREE.AnimationMixer(loadedScene);
            gltf.animations.forEach((clip) => {
                this.animations[clip.name] = clip;
            });
            
            this.isModelLoaded = true;
            
            // If the model was spawned before loading completed, add it to scene now
            if (this.pendingSpawn) {
                gameContext.scene.add(this.model);
                this.pendingSpawn = false;
                console.log(`${this.config.name} model loaded and added to scene`);
            }
            
            // Optional: Play a default animation if one exists.
            if (gltf.animations.length > 0) {
                this.playAnimation(gltf.animations[0].name);
            }

        }, undefined, (error) => {
            console.error(`An error happened loading model: ${path}`, error);
            // Fallback to procedural model if GLB fails to load
            this.createBody();
            this.createLegs();
            this.createHead();
            this.isModelLoaded = true;
            
            if (this.pendingSpawn) {
                gameContext.scene.add(this.model);
                this.pendingSpawn = false;
                console.log(`${this.config.name} fallback model created and added to scene`);
            }
        });
    }

    createBody() {
        const bodyMaterial = new THREE.MeshLambertMaterial({ color: this.config.bodyColor });
        const bodyGeometry = new THREE.BoxGeometry(this.config.bodySize.x, this.config.bodySize.y, this.config.bodySize.z);
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.castShadow = true;
        body.name = 'body';
        this.model.add(body);
        this.model.body = body;

        if (this.config.vitals) {
            this.createVitals(body);
        }
    }

    createVitals(parent) {
        const vitalsGeometry = new THREE.BoxGeometry(this.config.vitals.size.x, this.config.vitals.size.y, this.config.vitals.size.z);
        // The 'visible' property belongs on the mesh, not the material.
        const vitalsMaterial = new THREE.MeshBasicMaterial({ color: this.config.vitals.debugColor });
        const vitals = new THREE.Mesh(vitalsGeometry, vitalsMaterial);
        vitals.visible = false; // Set visibility on the object itself.
        vitals.position.set(this.config.vitals.offset.x, this.config.vitals.offset.y, this.config.vitals.offset.z);
        vitals.name = 'vitals';
        parent.add(vitals);
        this.model.vitals = vitals;
    }

    createLegs() {
        this.model.legs = [];
        const legMaterial = new THREE.MeshLambertMaterial({ color: this.config.bodyColor });
        this.config.legs.positions.forEach(pos => {
            const legGeometry = new THREE.CylinderGeometry(this.config.legs.radiusTop, this.config.legs.radiusBottom, this.config.legs.height, this.config.legs.segments);
            const leg = new THREE.Mesh(legGeometry, legMaterial);
            leg.castShadow = true;
            leg.position.set(pos.x, this.config.legs.yOffset, pos.z);
            this.model.add(leg);
            this.model.legs.push(leg);
        });
    }

    createHead() {
        const headMaterial = new THREE.MeshLambertMaterial({ color: this.config.bodyColor });

        const neck = new THREE.Group();
        const neckGeometry = new THREE.CylinderGeometry(this.config.neck.radiusTop, this.config.neck.radiusBottom, this.config.neck.height, this.config.neck.segments);
        const neckMesh = new THREE.Mesh(neckGeometry, headMaterial);
        neckMesh.position.y = this.config.neck.positionYOffset;
        neck.add(neckMesh);

        neck.position.set(this.config.neck.groupOffset.x, this.config.neck.groupOffset.y, this.config.neck.groupOffset.z);
        neck.rotation.z = this.config.neck.rotationZ;
        this.model.neck = neck;

        const headGroup = new THREE.Group();
        const headGeometry = new THREE.BoxGeometry(this.config.head.size.x, this.config.head.size.y, this.config.head.size.z);
        const headMesh = new THREE.Mesh(headGeometry, headMaterial);
        headGroup.position.y = this.config.head.positionYOffset;
        headGroup.add(headMesh);
        
        neck.add(headGroup);
        this.model.add(neck);
    }

    setState(newState) {
        this.state = newState;
        this.stateTimer = 0;
        // Further state initialization can be done in subclasses
    }

    update(delta) {
        if (this.mixer) {
            this.mixer.update(delta);
        }

        this.stateTimer += delta;

        // Boundary check
        const worldSize = gameContext.terrain.geometry.parameters.width;
        const boundary = worldSize / 2 - (this.config.worldBoundaryMargin || 20);
        if (Math.abs(this.model.position.x) > boundary || Math.abs(this.model.position.z) > boundary) {
            const center = new THREE.Vector3(0, this.model.position.y, 0);
            this.model.lookAt(center);
        }

        // Update position based on terrain height
        this.model.position.y = gameContext.getHeightAt(this.model.position.x, this.model.position.z) + this.config.heightOffset;
    }

    spawn(position, rotationY) {
        this.model.position.copy(position);
        this.model.rotation.y = rotationY || 0;
        this.setState('IDLE');

        if (this.isModelLoaded) {
            gameContext.scene.add(this.model);
            console.log(`${this.config.name} spawned and added to scene`);
        } else {
            this.pendingSpawn = true;
            console.log(`${this.config.name} spawn pending model load`);
        }
    }

    playAnimation(name, loop = true) {
        if (!name || !this.mixer || !this.animations[name]) {
            return;
        }

        const newAction = this.mixer.clipAction(this.animations[name]);
        if (this.activeAction) {
            this.activeAction.fadeOut(0.5);
        }

        newAction.reset();
        newAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        newAction.clampWhenFinished = !loop;
        newAction.enabled = true;
        newAction.fadeIn(0.5).play();

        this.activeAction = newAction;
    }
}
