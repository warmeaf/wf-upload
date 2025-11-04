import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let controller: AppController;
  let service: AppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHello: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AppController>(AppController);
    service = module.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHello', () => {
    it('should return "Hello World!"', () => {
      const expectedResult = 'Hello World!';
      jest.spyOn(service, 'getHello').mockReturnValue(expectedResult);

      const result = controller.getHello();

      expect(result).toBe(expectedResult);
      expect(service.getHello).toHaveBeenCalled();
    });

    it('should call AppService.getHello', () => {
      jest.spyOn(service, 'getHello').mockReturnValue('Hello World!');

      controller.getHello();

      expect(service.getHello).toHaveBeenCalledTimes(1);
    });
  });
});

