import type { DiscoverSliderType } from '@server/constants/discover';
import {
  defaultSliders,
  reconcileDiscoverySliders,
} from '@server/constants/discover';
import { getRepository } from '@server/datasource';
import logger from '@server/logger';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
class DiscoverSlider {
  public static async bootstrapSliders(): Promise<void> {
    const sliderRepository = getRepository(DiscoverSlider);

    await sliderRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(DiscoverSlider);
      const existing = await repository.find({
        order: { order: 'ASC', id: 'ASC' },
      });
      if (
        defaultSliders.every((slider) =>
          existing.some((row) => row.type === slider.type)
        )
      )
        return;
      const rows = reconcileDiscoverySliders(existing);
      logger.info(
        'Adding missing built-in discovery sliders without resetting customization',
        { label: 'Discover Slider' }
      );
      await repository.save(rows.map((row) => new DiscoverSlider(row)));
    });
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'int' })
  public type: DiscoverSliderType;

  @Column({ type: 'int' })
  public order: number;

  @Column({ default: false })
  public isBuiltIn: boolean;

  @Column({ default: true })
  public enabled: boolean;

  @Column({ nullable: true })
  // Title is not required for built in sliders because we will
  // use translations for them.
  public title?: string;

  @Column({ nullable: true })
  public data?: string;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<DiscoverSlider>) {
    Object.assign(this, init);
  }
}

export default DiscoverSlider;
