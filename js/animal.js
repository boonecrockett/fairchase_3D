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
        this.pendingSpawnPosition = null;
        this.pendingSpawnRotation = null;
        this.shouldSpawnOnLoad = false;

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
            // No rotation applied - testing natural model orientation
            // loadedScene.rotation.y = -Math.PI / 2; // 90 degrees clockwise
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
                console.log('DEBUG: Animal loadModel calling createVitals with bodyMesh:', bodyMesh);
                this.createVitals(bodyMesh);
                console.log('DEBUG: Animal loadModel after createVitals');
                
                // Check if hitboxes are still attached immediately after creation
                setTimeout(() => {
                    console.log('DEBUG: Checking hitboxes 1 second after model load:', {
                        vitals: !!this.model.vitals,
                        gut: !!this.model.gut,
                        rear: !!this.model.rear,
                        modelKeys: Object.keys(this.model)
                    });
                }, 1000);
            } else {
                console.log('DEBUG: Animal loadModel - vitals config or bodyMesh missing:', {
                    hasVitalsConfig: !!this.config.vitals,
                    hasBodyMesh: !!bodyMesh
                });
            }



            // Set up the animation mixer.
            this.mixer = new THREE.AnimationMixer(loadedScene);
            gltf.animations.forEach((clip, index) => {
                this.animations[clip.name] = clip;
            });

            // Set the loaded model as the new model.
            this.model = gltf.scene;

            // RESTORE HITBOXES: Re-attach hitboxes from the hitboxMeshes array to the new model.
            if (this.hitboxMeshes && this.hitboxMeshes.length > 0) {
                console.log(`🔴 DEBUG: Re-attaching ${this.hitboxMeshes.length} hitboxes to new model.`);
                this.hitboxMeshes.forEach(hitbox => {
                    this.model.add(hitbox);
                });
            }

            this.setupModel();
            this.isModelLoaded = true;
            
            if (this.shouldSpawnOnLoad) {
                this.spawn(this.pendingSpawnPosition, this.pendingSpawnRotation);
                this.shouldSpawnOnLoad = false;
            }
        }, undefined, (error) => {
            // console.error(`An error happened loading model: ${path}`, error); // Logging disabled
            // Fallback to procedural model if GLB fails to load
            this.createBody();
            this.createLegs();
            this.createHead();
            this.isModelLoaded = true;
        });
    }

    setupModel() {
        // Add any necessary setup logic here
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

        if (this.config.brain) {
            this.createBrain(body);
        }
    }

    createVitals(parent) {
        const vitalsGeometry = new THREE.BoxGeometry(this.config.vitals.size.x, this.config.vitals.size.y, this.config.vitals.size.z);
        const vitalsMaterial = new THREE.MeshBasicMaterial({ color: this.config.vitals.debugColor });
        const vitals = new THREE.Mesh(vitalsGeometry, vitalsMaterial);
        vitals.visible = false; // Hidden for normal gameplay
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
        
        // Store reference to head for independent rotation (head turning)
        this.model.head = headGroup;
        
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
        } else {
            this.pendingSpawnPosition = position;
            this.pendingSpawnRotation = rotationY;
            this.shouldSpawnOnLoad = true;
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
